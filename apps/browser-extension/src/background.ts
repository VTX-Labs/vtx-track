/**
 * vtx-track browser extension — MV3 service worker.
 *
 * Watches the active tab and reports its *domain only* (never the full URL) to
 * the local vtx-track daemon, so the daemon can enrich the "browser is focused"
 * segment it is already timing with tab-granularity context. The extension
 * keeps no clock of its own — it just pushes context, mirroring the VS Code
 * extension's enrichment model (see DESIGN.md §5).
 *
 * All egress is to `http://127.0.0.1:7842` (localhost). If the daemon is
 * offline the POST fails silently — tracking the daemon's availability is not
 * this extension's job.
 */
import { isDenied, registrableDomain } from "./domain.js";
import {
  type BrowserContext,
  DAEMON_ENDPOINT,
  getSettings,
  HEARTBEAT_ALARM,
  HEARTBEAT_PERIOD_MINUTES,
  setSettings,
} from "./settings.js";

/**
 * The browser cannot reliably learn its own OS process id from an extension
 * sandbox, so we report `-1`. The daemon already sees the foreground browser
 * process and attaches this context by matching the foreground browser; the
 * pid field is reserved for a future native-messaging bridge that can supply
 * the real value. See README → Limitations.
 */
const UNKNOWN_PID = -1;

/**
 * The last domain we reported, so the popup can show it without re-querying and
 * so the heartbeat can re-assert the current domain cheaply.
 */
let lastReportedDomain = "";

/** Resolve the domain for the currently active tab in the focused window. */
async function getActiveDomain(): Promise<{ domain: string; title: string }> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { domain: "", title: "" };
  return {
    domain: registrableDomain(tab.url),
    title: tab.title ?? "",
  };
}

/**
 * Report a domain to the daemon, honouring the enabled toggle, the denylist,
 * and the tab-title privacy setting. No-ops (and clears the cached domain) when
 * tracking is disabled or the domain is empty/denied.
 */
async function report(domain: string, tabTitle: string): Promise<void> {
  const settings = await getSettings();

  if (!settings.enabled || !domain || isDenied(domain, settings.denylist)) {
    lastReportedDomain = "";
    return;
  }

  const body: BrowserContext = settings.sendTabTitles && tabTitle
    ? { pid: UNKNOWN_PID, domain, tabTitle }
    : { pid: UNKNOWN_PID, domain };

  lastReportedDomain = domain;

  try {
    await fetch(DAEMON_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      // The daemon enables CORS for localhost; keepalive lets the POST survive
      // the service worker spinning down right after a tab switch.
      keepalive: true,
    });
  } catch {
    // Daemon offline or unreachable — fail silently by design.
  }
}

/** Read the active tab and report it. The single entry point for all triggers. */
async function syncActiveTab(): Promise<void> {
  const { domain, title } = await getActiveDomain();
  await report(domain, title);
}

// ── Event wiring ────────────────────────────────────────────────────────────

// A different tab became active in some window.
chrome.tabs.onActivated.addListener(() => {
  void syncActiveTab();
});

// A tab navigated or its title changed. We only care about URL/title deltas on
// the active tab to avoid churning on background tabs.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url === undefined && changeInfo.title === undefined && changeInfo.status === undefined) {
    return;
  }
  void syncActiveTab();
});

// The focused window changed (e.g. user alt-tabbed to another browser window).
chrome.windows.onFocusChanged.addListener(() => {
  void syncActiveTab();
});

// Periodic heartbeat: re-assert the current domain so the daemon's segment
// stays enriched even if no tab/window event fired for a while.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) void syncActiveTab();
});

// Re-create the heartbeat alarm whenever the worker (re)starts or installs.
function ensureHeartbeat(): void {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
}

chrome.runtime.onStartup.addListener(() => {
  ensureHeartbeat();
  void syncActiveTab();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureHeartbeat();
  void syncActiveTab();
});

// ── Popup messaging ───────────────────────────────────────────────────────────

/** Messages the popup can send the worker. */
export type PopupMessage =
  | { type: "getStatus" }
  | { type: "toggleEnabled"; enabled: boolean };

/** The worker's reply to `getStatus`. */
export interface StatusReply {
  enabled: boolean;
  domain: string;
}

chrome.runtime.onMessage.addListener(
  (message: PopupMessage, _sender, sendResponse: (reply: StatusReply) => void) => {
    void (async () => {
      if (message.type === "toggleEnabled") {
        await setSettings({ enabled: message.enabled });
        if (message.enabled) {
          await syncActiveTab();
        } else {
          lastReportedDomain = "";
        }
      }
      const settings = await getSettings();
      // Refresh the cached domain so the popup always shows the live value.
      if (settings.enabled) {
        const { domain } = await getActiveDomain();
        if (domain && !isDenied(domain, settings.denylist)) {
          lastReportedDomain = domain;
        } else {
          lastReportedDomain = "";
        }
      }
      sendResponse({ enabled: settings.enabled, domain: lastReportedDomain });
    })();
    // Keep the message channel open for the async response.
    return true;
  },
);

// Run once on worker load (covers the common case of the worker waking on an
// event other than startup/install).
ensureHeartbeat();
void syncActiveTab();
