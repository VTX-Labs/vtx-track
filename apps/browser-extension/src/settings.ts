/**
 * Typed wrapper over `chrome.storage.sync` for the extension's settings.
 *
 * Settings sync across the user's signed-in browsers but never leave the
 * browser vendor's profile sync — they are not sent to the vtx-track daemon.
 */

/** The daemon's localhost context endpoint. Localhost only; never remote. */
export const DAEMON_ENDPOINT = "http://127.0.0.1:7842/context/browser";

/**
 * Wire shape the daemon's `POST /context/browser` expects. Mirrors
 * `BrowserContext` from `@vtx-track/protocol`, inlined here so the extension
 * stays a zero-dependency, standalone build with no workspace imports.
 */
export interface BrowserContext {
  /** OS pid of the browser process, or -1 when the extension can't know it. */
  pid: number;
  /** Registrable domain, e.g. "github.com". Never the full URL by default. */
  domain: string;
  /** Tab title — only sent when the user opts in. */
  tabTitle?: string;
}

/** Heartbeat alarm name and period (minutes; Chrome's alarm minimum is ~1m). */
export const HEARTBEAT_ALARM = "vtx-track-heartbeat";
export const HEARTBEAT_PERIOD_MINUTES = 1;

/** User-configurable extension settings. */
export interface Settings {
  /** Master on/off switch. When false, nothing is ever reported. */
  enabled: boolean;
  /**
   * When true, the tab title is included alongside the domain. Default OFF for
   * privacy — even then no URL path/query is ever sent.
   */
  sendTabTitles: boolean;
  /** Domains (and their subdomains) that must never be reported. */
  denylist: string[];
}

/** Conservative, privacy-first defaults. */
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  sendTabTitles: false,
  denylist: [],
};

/** Read the full settings object, filling any missing keys with defaults. */
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    enabled: Boolean(stored.enabled),
    sendTabTitles: Boolean(stored.sendTabTitles),
    denylist: normalizeDenylist(stored.denylist),
  };
}

/** Persist a partial settings update. */
export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const clean: Partial<Settings> = {};
  if (patch.enabled !== undefined) clean.enabled = patch.enabled;
  if (patch.sendTabTitles !== undefined) clean.sendTabTitles = patch.sendTabTitles;
  if (patch.denylist !== undefined) clean.denylist = normalizeDenylist(patch.denylist);
  await chrome.storage.sync.set(clean);
}

/** Coerce arbitrary stored input into a clean, de-duplicated denylist. */
export function normalizeDenylist(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const entry = raw.trim().toLowerCase();
    if (entry) seen.add(entry);
  }
  return [...seen];
}
