/**
 * On-device AI insight for the dashboard.
 *
 * Uses Chrome's built-in Prompt API (Gemini Nano) when available, so the
 * summary is generated entirely on the user's machine — nothing leaves it,
 * matching vtx-track's local-first promise. The model is asked for STRUCTURED
 * output (a JSON object matching `INSIGHT_SCHEMA`) via `responseConstraint`, so
 * the dashboard can render rich components — a headline, scored insight cards,
 * an app spotlight, and an action — rather than a wall of text. When the API is
 * missing or the model unavailable (other browsers, unsupported hardware), the
 * caller falls back to a computed structured insight.
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

/** One scored observation card. */
export interface InsightCard {
  /** Drives the card's color + icon. */
  kind: "win" | "watch" | "tip";
  /** One short, specific sentence. */
  text: string;
}

/** The structured insight the dashboard renders. */
export interface Insight {
  /** A short, punchy headline (≤ 8 words). */
  headline: string;
  /** Overall vibe for the range. */
  vibe: "deep-focus" | "steady" | "scattered";
  /** 2–3 observation cards. */
  cards: InsightCard[];
  /** The app to spotlight (must be one of the provided top app names). */
  spotlightApp: string | null;
  /** One concrete, actionable next step. */
  action: string;
}

export interface InsightResult {
  insight: Insight;
  source: "model" | "computed";
}

/** JSON schema constraining the model's output to {@link Insight}. */
const INSIGHT_SCHEMA = {
  type: "object",
  required: ["headline", "vibe", "cards", "action"],
  additionalProperties: false,
  properties: {
    headline: { type: "string", maxLength: 60 },
    vibe: { type: "string", enum: ["deep-focus", "steady", "scattered"] },
    cards: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        required: ["kind", "text"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["win", "watch", "tip"] },
          text: { type: "string", maxLength: 140 },
        },
      },
    },
    spotlightApp: { type: ["string", "null"] },
    action: { type: "string", maxLength: 140 },
  },
} as const;

type Availability = "available" | "downloadable" | "downloading" | "unavailable";

interface LanguageModelSession {
  prompt(
    input: string,
    opts?: { signal?: AbortSignal; responseConstraint?: unknown },
  ): Promise<string>;
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
  "You are a sharp, encouraging productivity coach embedded in a local, " +
  "privacy-first time-tracking app. You receive a compact summary of how " +
  "someone spent their time and must return a single JSON object describing " +
  "the day. Be specific and reference the actual apps and numbers given. " +
  "Card kinds: 'win' = something good, 'watch' = a concern, 'tip' = advice. " +
  "Pick spotlightApp from the provided top apps only. Keep every string tight " +
  "and concrete — no fluff, no markdown, no emoji.";

/** Render the facts into a compact prompt body the model can reason over. */
function factsToPrompt(facts: InsightFacts, rangeLabel: string): string {
  const lines: string[] = [
    `Range: ${rangeLabel}.`,
    `Total tracked: ${formatDuration(facts.totalMs)}.`,
  ];
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
        facts.topCategories.map((c) => `${c.name} (${formatPercent(c.share)})`).join(", ") +
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
  lines.push(
    "Return JSON: a punchy headline, an overall vibe, 2-3 cards, the " +
      "spotlight app, and one actionable next step.",
  );
  return lines.join("\n");
}

/** Coerce arbitrary parsed JSON into a safe {@link Insight}. */
function coerceInsight(raw: unknown, facts: InsightFacts): Insight {
  const o = (raw ?? {}) as Record<string, unknown>;
  const validApps = new Set(facts.topApps.map((a) => a.name));
  const vibe = o.vibe;
  const cardsIn = Array.isArray(o.cards) ? o.cards : [];
  const cards: InsightCard[] = cardsIn
    .map((c) => {
      const cc = (c ?? {}) as Record<string, unknown>;
      const kind = cc.kind;
      return {
        kind: kind === "win" || kind === "watch" || kind === "tip" ? kind : "tip",
        text: typeof cc.text === "string" ? cc.text : "",
      } as InsightCard;
    })
    .filter((c) => c.text.trim().length > 0)
    .slice(0, 3);

  const spotlight =
    typeof o.spotlightApp === "string" && validApps.has(o.spotlightApp)
      ? o.spotlightApp
      : (facts.topApps[0]?.name ?? null);

  return {
    headline:
      typeof o.headline === "string" && o.headline.trim() ? o.headline.trim() : "Your day at a glance",
    vibe: vibe === "deep-focus" || vibe === "steady" || vibe === "scattered" ? vibe : "steady",
    cards: cards.length ? cards : [{ kind: "tip", text: "Keep tracking to surface trends." }],
    spotlightApp: spotlight,
    action: typeof o.action === "string" && o.action.trim() ? o.action.trim() : "",
  };
}

/**
 * Produce a structured insight. Tries the on-device model with a JSON
 * `responseConstraint`; throws if the model is unavailable so the caller can
 * apply its computed fallback. The model is only used when already downloaded
 * ("available") — we don't trigger a multi-GB download from a passive refresh.
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
    throw new Error(`model ${availability}`);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  let session: LanguageModelSession | null = null;
  try {
    session = await lm.create({
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
      systemPrompt: SYSTEM_PROMPT, // legacy convenience; ignored where unsupported
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      signal: controller.signal,
    });
    const out = await session.prompt(factsToPrompt(facts, rangeLabel), {
      signal: controller.signal,
      responseConstraint: INSIGHT_SCHEMA,
    });
    // The model can still emit malformed JSON; a parse failure must surface as
    // an error so the caller falls back to the computed insight (never hang).
    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new Error("model output was not valid JSON");
    }
    return { insight: coerceInsight(parsed, facts), source: "model" };
  } finally {
    // Always release the session and the timer, including on prompt/timeout error.
    session?.destroy?.();
    window.clearTimeout(timeout);
  }
}

/** A deterministic, no-model structured insight for the fallback path. */
export function computedInsight(facts: InsightFacts): Insight {
  const top = facts.topApps[0];
  const cat = facts.topCategories[0];
  const cards: InsightCard[] = [];

  if (top) {
    cards.push({
      kind: "win",
      text: `${top.name} led your time at ${formatPercent(top.share)} (${formatDuration(top.ms)}).`,
    });
  }
  if (cat) {
    cards.push({
      kind: "tip",
      text: `Most effort landed in "${cat.name}".`,
    });
  }

  let vibe: Insight["vibe"] = "steady";
  if (facts.focus) {
    if (facts.focus.switchesPerHour > 20) {
      vibe = "scattered";
      cards.push({
        kind: "watch",
        text: `High context switching (${facts.focus.switchesPerHour.toFixed(0)}/hr) — batch similar work into blocks.`,
      });
    } else if (facts.focus.longestDeepWorkMs >= 25 * 60_000) {
      vibe = "deep-focus";
      cards.push({
        kind: "win",
        text: `Solid deep-work stretch of ${formatDuration(facts.focus.longestDeepWorkMs)}.`,
      });
    }
  }

  const action =
    facts.focus && facts.focus.switchesPerHour > 20
      ? "Try a 50-minute focus block on your top task with notifications off."
      : "Protect your next deep-work window — it's where the best work happens.";

  return {
    headline: `${formatDuration(facts.totalMs)} tracked${top ? `, mostly ${top.name}` : ""}`,
    vibe,
    cards: cards.slice(0, 3),
    spotlightApp: top?.name ?? null,
    action,
  };
}
