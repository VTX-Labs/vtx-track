/**
 * vtx-track popup — shows the current tracked domain and a pause toggle.
 *
 * The popup owns no state; it asks the service worker for status and tells it
 * to flip the enabled flag. All wording reinforces the privacy model: only the
 * domain is shown, and it is the same domain the daemon receives.
 */
import type { PopupMessage, StatusReply } from "./background.js";

const dot = document.getElementById("dot") as HTMLSpanElement;
const domainEl = document.getElementById("domain") as HTMLSpanElement;
const toggle = document.getElementById("toggle") as HTMLButtonElement;
const optionsBtn = document.getElementById("open-options") as HTMLButtonElement;

/** Send a typed message to the service worker and await its status reply. */
function ask(message: PopupMessage): Promise<StatusReply> {
  return chrome.runtime.sendMessage<PopupMessage, StatusReply>(message);
}

/** Paint the popup from a status reply. */
function render(status: StatusReply): void {
  dot.classList.toggle("on", status.enabled);

  if (!status.enabled) {
    domainEl.textContent = "paused";
    toggle.textContent = "Resume tracking";
    toggle.classList.add("paused");
    return;
  }

  domainEl.textContent = status.domain || "(no trackable tab)";
  toggle.textContent = "Pause tracking";
  toggle.classList.remove("paused");
}

async function refresh(): Promise<void> {
  try {
    render(await ask({ type: "getStatus" }));
  } catch {
    // Worker not ready yet — show a neutral state.
    domainEl.textContent = "—";
  }
}

toggle.addEventListener("click", () => {
  void (async () => {
    const current = await ask({ type: "getStatus" });
    render(await ask({ type: "toggleEnabled", enabled: !current.enabled }));
  })();
});

optionsBtn.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

void refresh();
