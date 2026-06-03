/**
 * vtx-track options page — toggle tracking, edit the denylist, and choose
 * whether tab titles are sent (default OFF for privacy).
 */
import { getSettings, normalizeDenylist, setSettings } from "./settings.js";

const enabled = document.getElementById("enabled") as HTMLInputElement;
const sendTabTitles = document.getElementById("sendTabTitles") as HTMLInputElement;
const denylist = document.getElementById("denylist") as HTMLTextAreaElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLSpanElement;

/** Load current settings into the form. */
async function load(): Promise<void> {
  const settings = await getSettings();
  enabled.checked = settings.enabled;
  sendTabTitles.checked = settings.sendTabTitles;
  denylist.value = settings.denylist.join("\n");
}

/** Parse a textarea into a clean denylist (one entry per line). */
function parseDenylist(text: string): string[] {
  return normalizeDenylist(text.split(/\r?\n/));
}

/** Briefly flash a status message. */
function flash(message: string): void {
  status.textContent = message;
  window.setTimeout(() => {
    status.textContent = "";
  }, 2000);
}

async function save(): Promise<void> {
  const cleaned = parseDenylist(denylist.value);
  await setSettings({
    enabled: enabled.checked,
    sendTabTitles: sendTabTitles.checked,
    denylist: cleaned,
  });
  // Reflect the normalized denylist back into the textarea.
  denylist.value = cleaned.join("\n");
  flash("Saved.");
}

saveBtn.addEventListener("click", () => {
  void save();
});

void load();
