/**
 * On-device AI insight for the dashboard.
 *
 * Uses Chrome's built-in Prompt API (Gemini Nano) when available, so the
 * summary is generated entirely on the user's machine — nothing leaves it,
 * matching vtx-track's local-first promise. When the API is missing or the
 * model is unavailable (other browsers, unsupported hardware), the caller's
 * computed fallback is used instead.
 *
 * The API was renamed several times across Chrome versions; we feature-detect
 * the canonical `LanguageModel` global first, then the legacy `ai.languageModel`
 * namespace, and normalize the availability enum across both.
 */
import { formatDuration, formatPercent } from "./format.js";

/** The compact facts an insight is generated from (built by the caller). */
export interface InsightFacts {
  totalMs: number;
  topApps: Array<{ name: string; ms: number; share: number }>;
  topCategories: Array<{ name: string; ms: number; share: number }>;
  focus: {
    totalActiveMs: number;
    contextSwitches: number;
    switchesPerHour: number;
    longestDeepWorkMs: number;
    deepWorkSessions: number;
  } | null;
}

export interface InsightResult {
  text: string;
  source: "model" | "computed";
}

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

interface LanguageModelSession {
  prompt(input: string, opts?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
}

interface LanguageModelLike {
  availability?(opts?: unknown): Promise<Availability>;
  capabilities?(): Promise<{ available?: string }>;
  create?(opts?: unknown): Promise<LanguageModelSession>;
}

/** Resolve the current `LanguageModel` global, or a legacy shim, or null. */
function getLanguageModel(): LanguageModelLike | null {
  const g = globalThis as unknown as {
    LanguageModel?: LanguageModelLike;
    ai?: { languageModel?: LanguageModelLike } & LanguageModelLike;
  };
  if (g.LanguageModel) return g.LanguageModel; // current (Chrome 138+/148 stable)
  if (g.ai?.languageModel) return g.ai.languageModel; // legacy self.ai.languageModel
  if (g.ai) return g.ai; // very old window.ai
  return null;
}

/** Normalize availability across the new `availability()` and legacy `capabilities()`. */
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
      switch (caps?.available) {
        case "readily":
          return "available";
        case "after-download":
          return "downloadable";
        default:
          return "unavailable";
      }
    } catch {
      return "unavailable";
    }
  }
  return "unavailable";
}

const SYSTEM_PROMPT =
  "You are a concise productivity coach embedded in a local time-tracking app. " +
  "Given a compact summary of how someone spent their time, reply with 2-3 short, " +
  "specific, encouraging sentences. Mention the standout app or category and one " +
  "actionable observation about focus. No preamble, no markdown, no lists.";

/** Render the facts into a compact prompt body the model can reason over. */
function factsToPrompt(facts: InsightFacts, rangeLabel: string): string {
  const lines: string[] = [`Range: ${rangeLabel}.`, `Total tracked: ${formatDuration(facts.totalMs)}.`];
  if (facts.topApps.length) {
    lines.push(
      "Top apps: " +
        facts.topApps
          .map((a) => `${a.name} (${formatDuration(a.ms)}, ${formatPercent(a.share)})`)
          .join(", ") +
        ".",
    );
  }
  if (facts.topCategories.length) {
    lines.push(
      "Categories: " +
        facts.topCategories
          .map((c) => `${c.name} (${formatPercent(c.share)})`)
          .join(", ") +
        ".",
    );
  }
  if (facts.focus) {
    lines.push(
      `Focus: ${facts.focus.contextSwitches} context switches ` +
        `(${facts.focus.switchesPerHour.toFixed(1)}/hr), ` +
        `longest deep-work ${formatDuration(facts.focus.longestDeepWorkMs)} ` +
        `across ${facts.focus.deepWorkSessions} session(s).`,
    );
  }
  return lines.join("\n");
}

/**
 * Produce an insight string. Tries the on-device model; throws if unavailable
 * so the caller can apply its computed fallback. The model is only used when it
 * is already downloaded ("available") — we don't trigger a multi-GB download
 * from a passive dashboard refresh.
 */
export async function aiInsight(
  facts: InsightFacts,
  rangeLabel: string,
): Promise<InsightResult> {
  const lm = getLanguageModel();
  if (!lm || typeof lm.create !== "function") {
    throw new Error("Prompt API not supported");
  }
  const availability = await resolveAvailability(lm);
  if (availability !== "available") {
    // "downloadable"/"downloading"/"unavailable": don't block on a download.
    throw new Error(`model ${availability}`);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const session = await lm.create({
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
      // Legacy convenience accepted by older builds; ignored where unsupported.
      systemPrompt: SYSTEM_PROMPT,
      signal: controller.signal,
    });
    const text = await session.prompt(factsToPrompt(facts, rangeLabel), {
      signal: controller.signal,
    });
    session.destroy?.();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("empty response");
    return { text: trimmed, source: "model" };
  } finally {
    window.clearTimeout(timeout);
  }
}
