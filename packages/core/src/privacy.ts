import type { Config, WindowSample } from "@vtx-track/protocol";

/** Built-in patterns redacted in `patterns` mode: emails, bearer-ish tokens, URLs with query. */
const BUILTIN_REDACTION_PATTERNS = [
  "[\\w.+-]+@[\\w-]+\\.[\\w.-]+", // email
  "(?:token|key|secret|password|pwd)=\\S+", // key=value secrets
  "[A-Za-z0-9_-]{32,}", // long opaque tokens
];

/** The result of applying privacy rules to a sample. */
export interface PrivacyDecision {
  /** True if the segment must not be recorded at all (denylisted / paused). */
  denied: boolean;
  /** The window title after redaction, or null if titles are dropped. */
  title: string | null;
}

/**
 * Applies the user's privacy rules to a sample *before* it is persisted.
 *
 * - **Denylist** — if the app name or a provided domain matches (case-insensitive
 *   substring), the segment is denied entirely.
 * - **Redaction** — `full` keeps titles; `apps-only` drops them; `patterns`
 *   masks built-in + user-supplied regexes.
 */
export class PrivacyFilter {
  private readonly denylist: string[];
  private readonly redaction: Config["redaction"];
  private readonly patterns: RegExp[];

  constructor(config: Config) {
    this.denylist = config.denylist.map((d) => d.toLowerCase());
    this.redaction = config.redaction;
    this.patterns =
      config.redaction === "patterns"
        ? [...BUILTIN_REDACTION_PATTERNS, ...config.redactionPatterns]
            .map(compile)
            .filter((r): r is RegExp => r !== null)
        : [];
  }

  /** Decide what (if anything) to record for a sample. */
  apply(sample: WindowSample, domain?: string): PrivacyDecision {
    if (this.isDenied(sample.app) || (domain && this.isDenied(domain))) {
      return { denied: true, title: null };
    }
    return { denied: false, title: this.redact(sample.title) };
  }

  private isDenied(value: string): boolean {
    const lower = value.toLowerCase();
    return this.denylist.some((d) => d.length > 0 && lower.includes(d));
  }

  private redact(title: string): string | null {
    if (this.redaction === "apps-only") return null;
    if (this.redaction === "full") return title;
    let out = title;
    for (const re of this.patterns) out = out.replace(re, "[redacted]");
    return out;
  }
}

function compile(source: string): RegExp | null {
  try {
    return new RegExp(source, "gi");
  } catch {
    return null;
  }
}
