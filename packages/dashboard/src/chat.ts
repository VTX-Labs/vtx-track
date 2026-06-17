/**
 * On-device AI chat copilot with tool-calling.
 *
 * Chrome's built-in Prompt API (Gemini Nano) has no native function-calling,
 * so we implement a small ReAct-style loop on top of structured output: each
 * turn the model returns JSON that is either a tool call or a final answer.
 * When it asks for a tool we execute it against the daemon's localhost API,
 * feed the result back, and prompt again — up to a step budget. The final
 * answer may include rich "components" (stat, bars, chips, callout) that the
 * dashboard renders inline. Everything runs on the user's machine.
 *
 * The agent is constructed with a set of {@link AgentTool}s so the data layer
 * stays out of this module (testable, daemon-agnostic).
 */

/** A tool the model may call. `run` receives validated args and returns data. */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON-schema-ish parameter description, inlined into the system prompt. */
  args: Record<string, string>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/** A rich component the model can emit in its final answer. */
export type ChatComponent =
  | { type: "stat"; label: string; value: string; hint?: string | undefined }
  | {
      type: "bars";
      title?: string | undefined;
      items: Array<{ label: string; value: number; display: string }>;
    }
  | {
      // App rows with real icons (the host resolves icons for `app` names).
      type: "applist";
      title?: string | undefined;
      items: Array<{ app: string; value: number; display: string }>;
    }
  | { type: "chips"; items: string[] }
  | { type: "callout"; tone: "good" | "warn" | "info"; text: string };

/** The assistant's final, rendered turn. */
export interface ChatAnswer {
  text: string;
  components: ChatComponent[];
}

export interface ChatHandlers {
  /** Called when the agent invokes a tool (for a "thinking" trace in the UI). */
  onToolCall?(name: string, args: Record<string, unknown>): void;
}

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

interface LanguageModelSession {
  prompt(
    input: string,
    opts?: { signal?: AbortSignal | undefined; responseConstraint?: unknown },
  ): Promise<string>;
  destroy?(): void;
}

interface LanguageModelLike {
  availability?(opts?: unknown): Promise<Availability>;
  capabilities?(): Promise<{ available?: string }>;
  create?(opts?: unknown): Promise<LanguageModelSession>;
}

function getLanguageModel(): LanguageModelLike | null {
  const g = globalThis as unknown as {
    LanguageModel?: LanguageModelLike;
    ai?: { languageModel?: LanguageModelLike } & LanguageModelLike;
  };
  if (g.LanguageModel) return g.LanguageModel;
  if (g.ai?.languageModel) return g.ai.languageModel;
  if (g.ai) return g.ai;
  return null;
}

async function resolveAvailability(lm: LanguageModelLike): Promise<Availability> {
  if (typeof lm.availability === "function") {
    try {
      return await lm.availability();
    } catch {
      return "unavailable";
    }
  }
  if (typeof lm.capabilities === "function") {
    try {
      const caps = await lm.capabilities();
      if (caps?.available === "readily") return "available";
      if (caps?.available === "after-download") return "downloadable";
    } catch {
      /* fall through */
    }
  }
  return "unavailable";
}

/** True when the on-device model is downloaded and ready. */
export async function chatAvailable(): Promise<boolean> {
  const lm = getLanguageModel();
  if (!lm || typeof lm.create !== "function") return false;
  return (await resolveAvailability(lm)) === "available";
}

/** Each agent step is one of these two shapes (enforced by the schema). */
const STEP_SCHEMA = {
  type: "object",
  required: ["action"],
  additionalProperties: true,
  properties: {
    action: { type: "string", enum: ["tool", "answer"] },
    // when action === "tool"
    tool: { type: "string" },
    args: { type: "object", additionalProperties: true },
    // when action === "answer"
    text: { type: "string", maxLength: 600 },
    components: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        required: ["type"],
        additionalProperties: true,
        properties: {
          type: { type: "string", enum: ["stat", "bars", "applist", "chips", "callout"] },
          label: { type: "string" },
          value: { type: "string" },
          hint: { type: "string" },
          title: { type: "string" },
          tone: { type: "string", enum: ["good", "warn", "info"] },
          text: { type: "string" },
          items: { type: "array" },
        },
      },
    },
  },
} as const;

const MAX_STEPS = 4;

function toolCatalog(tools: AgentTool[]): string {
  return tools
    .map((t) => {
      const args = Object.entries(t.args)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      return `- ${t.name}(${args}) — ${t.description}`;
    })
    .join("\n");
}

function systemPrompt(tools: AgentTool[]): string {
  return (
    "You are vtx-track's copilot: a concise, friendly assistant that answers " +
    "questions about the user's locally-tracked computer activity. You think " +
    "step by step and may call tools to fetch real numbers before answering. " +
    "Never invent figures — always ground claims in tool results.\n\n" +
    "Each turn, reply with ONE JSON object:\n" +
    '- To call a tool: {"action":"tool","tool":"<name>","args":{...}}\n' +
    '- To answer the user: {"action":"answer","text":"...","components":[...]}\n\n' +
    "Available tools:\n" +
    toolCatalog(tools) +
    "\n\nComponents you may include in an answer (optional, 0-4):\n" +
    '- {"type":"stat","label":"Active time","value":"3h 12m","hint":"today"}\n' +
    '- {"type":"applist","title":"Top apps","items":[{"app":"Visual Studio Code","value":56,"display":"2h 25m · 56%"}]}\n' +
    '- {"type":"bars","title":"By category","items":[{"label":"Coding","value":56,"display":"56%"}]}\n' +
    '- {"type":"chips","items":["Visual Studio Code","Chrome"]}\n' +
    '- {"type":"callout","tone":"warn","text":"High context switching."}\n\n' +
    "When listing APPLICATIONS, ALWAYS use an 'applist' (it shows each app's real " +
    "icon) and set `app` to the exact app name from the tool result. Use 'bars' for " +
    "non-app breakdowns like categories. Keep text under 4 sentences and prefer a " +
    "component over reciting numbers in prose. Call at most a couple of tools, then answer."
  );
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sanitizeComponents(raw: unknown): ChatComponent[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatComponent[] = [];
  for (const c of raw.slice(0, 4)) {
    const o = (c ?? {}) as Record<string, unknown>;
    if (o.type === "stat" && typeof o.label === "string" && typeof o.value === "string") {
      out.push({ type: "stat", label: o.label, value: o.value, hint: typeof o.hint === "string" ? o.hint : undefined });
    } else if (o.type === "bars" && Array.isArray(o.items)) {
      const items = o.items
        .map((it) => {
          const i = (it ?? {}) as Record<string, unknown>;
          return {
            label: typeof i.label === "string" ? i.label : "",
            value: typeof i.value === "number" ? i.value : Number(i.value) || 0,
            display: typeof i.display === "string" ? i.display : String(i.value ?? ""),
          };
        })
        .filter((i) => i.label)
        .slice(0, 8);
      if (items.length) out.push({ type: "bars", title: typeof o.title === "string" ? o.title : undefined, items });
    } else if (o.type === "applist" && Array.isArray(o.items)) {
      const items = o.items
        .map((it) => {
          const i = (it ?? {}) as Record<string, unknown>;
          return {
            app: typeof i.app === "string" ? i.app : typeof i.label === "string" ? i.label : "",
            value: typeof i.value === "number" ? i.value : Number(i.value) || 0,
            display: typeof i.display === "string" ? i.display : String(i.value ?? ""),
          };
        })
        .filter((i) => i.app)
        .slice(0, 8);
      if (items.length) out.push({ type: "applist", title: typeof o.title === "string" ? o.title : undefined, items });
    } else if (o.type === "chips" && Array.isArray(o.items)) {
      const items = o.items.filter((x): x is string => typeof x === "string").slice(0, 12);
      if (items.length) out.push({ type: "chips", items });
    } else if (o.type === "callout" && typeof o.text === "string") {
      const tone = o.tone === "good" || o.tone === "warn" || o.tone === "info" ? o.tone : "info";
      out.push({ type: "callout", tone, text: o.text });
    }
  }
  return out;
}

/**
 * Run one user question through the tool-calling loop and return the answer.
 * Throws if the on-device model is unavailable (caller shows a fallback).
 */
export async function askCopilot(
  question: string,
  tools: AgentTool[],
  handlers: ChatHandlers = {},
  signal?: AbortSignal,
): Promise<ChatAnswer> {
  const lm = getLanguageModel();
  if (!lm || typeof lm.create !== "function") throw new Error("Prompt API not supported");
  if ((await resolveAvailability(lm)) !== "available") throw new Error("model unavailable");

  const byName = new Map(tools.map((t) => [t.name, t]));
  const session = await lm.create({
    initialPrompts: [{ role: "system", content: systemPrompt(tools) }],
    systemPrompt: systemPrompt(tools),
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    signal,
  });

  try {
    let turn = `User question: ${question}`;
    for (let step = 0; step < MAX_STEPS; step++) {
      const raw = await session.prompt(turn, { signal, responseConstraint: STEP_SCHEMA });
      const obj = safeParse(raw);
      if (!obj) {
        // Model didn't return valid JSON — treat its text as the answer.
        return { text: raw.trim() || "I couldn't parse that.", components: [] };
      }

      if (obj.action === "answer" || step === MAX_STEPS - 1) {
        return {
          text: typeof obj.text === "string" && obj.text.trim() ? obj.text.trim() : "Here's what I found.",
          components: sanitizeComponents(obj.components),
        };
      }

      if (obj.action === "tool" && typeof obj.tool === "string") {
        const tool = byName.get(obj.tool);
        const args = (obj.args ?? {}) as Record<string, unknown>;
        handlers.onToolCall?.(obj.tool, args);
        if (!tool) {
          turn = `Tool "${obj.tool}" does not exist. Pick a valid tool or answer now.`;
          continue;
        }
        let result: unknown;
        try {
          result = await tool.run(args);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        turn =
          `Result of ${obj.tool}: ${JSON.stringify(result).slice(0, 1500)}\n` +
          "Use this to answer, or call another tool. Reply with one JSON object.";
        continue;
      }

      // Unknown shape — nudge it to answer.
      turn = 'Reply with {"action":"answer",...} now.';
    }
    return { text: "I wasn't able to finish that — try rephrasing.", components: [] };
  } finally {
    session.destroy?.();
  }
}
