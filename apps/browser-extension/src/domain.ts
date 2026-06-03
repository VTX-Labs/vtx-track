/**
 * Pure, dependency-free domain extraction for the vtx-track browser extension.
 *
 * Privacy is the whole point of this module: given a tab URL we return *only* a
 * registrable-ish domain, never a path, query string, or fragment. URLs that
 * should not be tracked at all (browser-internal pages, extension pages, blank
 * tabs) collapse to the empty string so callers can skip them.
 */

/**
 * URL schemes that represent browser-internal or non-web surfaces. Tabs on
 * these schemes carry no meaningful "domain" to track and are skipped.
 */
const SKIPPED_SCHEMES = new Set<string>([
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "edge:",
  "extension:",
  "moz-extension:",
  "about:",
  "devtools:",
  "view-source:",
  "data:",
  "blob:",
  "javascript:",
  "file:",
]);

/**
 * Extract the domain to report for a tab URL.
 *
 * The result is the hostname with any leading `www.` removed and lowercased.
 * The full path, query, and fragment are intentionally discarded — they are
 * never sent to the daemon. Browser-internal pages, extension pages, blank
 * tabs, and unparseable input all return `""` so the caller skips them.
 *
 * @param url - The raw tab URL (e.g. `chrome.tabs.Tab.url`), possibly empty.
 * @returns The registrable domain (e.g. `"github.com"`, `"localhost"`), or
 *   `""` when the URL should not be tracked.
 *
 * @example
 * registrableDomain("https://www.github.com/VTX-Labs/x?q=1"); // "github.com"
 * registrableDomain("http://localhost:3000");                 // "localhost"
 * registrableDomain("chrome://extensions");                   // ""
 */
export function registrableDomain(url: string | undefined | null): string {
  if (!url) return "";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }

  if (SKIPPED_SCHEMES.has(parsed.protocol)) return "";

  // Only http(s) (and ws(s) for completeness) carry a trackable web domain.
  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:" &&
    parsed.protocol !== "ws:" &&
    parsed.protocol !== "wss:"
  ) {
    return "";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return "";

  return stripWww(hostname);
}

/** Drop a single leading `www.` label from a hostname. */
function stripWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * True when `domain` is covered by the user's denylist. A denylist entry
 * matches its exact domain and any subdomain of it (case-insensitive), so
 * `example.com` blocks `app.example.com` too.
 *
 * @param domain - A domain produced by {@link registrableDomain}.
 * @param denylist - User-configured domains that must never be tracked.
 */
export function isDenied(domain: string, denylist: readonly string[]): boolean {
  if (!domain) return true;
  const target = domain.toLowerCase();
  return denylist.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    return target === entry || target.endsWith(`.${entry}`);
  });
}
