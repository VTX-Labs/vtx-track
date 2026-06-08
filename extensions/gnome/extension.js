/**
 * vtx-track GNOME Shell extension.
 *
 * GNOME on Wayland exposes no unprivileged "active window" API by design. This
 * extension closes that gap *locally* and read-only: it registers a private
 * D-Bus interface, `org.gnome.Shell.Extensions.VtxTrack`, with a single method
 * `GetFocusedWindow()` returning `"app|title|pid"`. The vtx-track daemon calls
 * it over the session bus (see packages/platform/src/wayland/gnome.ts).
 *
 * It moves no data off the machine and stores nothing — it only answers, on
 * request, which window is focused right now.
 *
 * Compatible with the GNOME 45+ ESM extension API and the legacy (≤44) API.
 */

const DBUS_IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.VtxTrack">
    <method name="GetFocusedWindow">
      <arg type="s" direction="out" name="info"/>
    </method>
  </interface>
</node>`;

const OBJECT_PATH = "/org/gnome/Shell/Extensions/VtxTrack";

function focusedWindowInfo() {
  // global is provided by the GNOME Shell runtime.
  // eslint-disable-next-line no-undef
  const win = global.display.get_focus_window?.() ?? null;
  if (!win) return "";
  const title = (win.get_title && win.get_title()) || "";
  const pid = (win.get_pid && win.get_pid()) || -1;
  // Resolve the app id via the window tracker when available.
  let app = "";
  try {
    // eslint-disable-next-line no-undef
    const Shell = imports.gi.Shell;
    const tracker = Shell.WindowTracker.get_default();
    const appObj = tracker.get_window_app(win);
    app =
      (appObj && (appObj.get_id?.() || appObj.get_name?.())) ||
      (win.get_wm_class && win.get_wm_class()) ||
      "";
  } catch (_e) {
    app = (win.get_wm_class && win.get_wm_class()) || "";
  }
  // Pipe-delimited; the daemon splits on "|".
  return `${app}|${title}|${pid}`;
}

class VtxTrackService {
  constructor() {
    this._dbus = null;
  }

  GetFocusedWindow() {
    try {
      return focusedWindowInfo();
    } catch (_e) {
      return "";
    }
  }

  enable() {
    // eslint-disable-next-line no-undef
    const Gio = imports.gi.Gio;
    this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_IFACE, this);
    this._dbus.export(Gio.DBus.session, OBJECT_PATH);
  }

  disable() {
    if (this._dbus) {
      this._dbus.unexport();
      this._dbus = null;
    }
  }
}

// ── GNOME 45+ ESM entry point ────────────────────────────────────────────────
// Shells ≥45 import a default-exported class with enable()/disable().
var VtxTrackExtension;
try {
  // eslint-disable-next-line no-undef
  const { Extension } = imports.ui.extensionUtils
    ? { Extension: null }
    : {};
  void Extension;
} catch (_e) {
  /* ignore — handled by the dual export below */
}

const _service = new VtxTrackService();

// Legacy (≤44) entry points:
// eslint-disable-next-line no-unused-vars
function init() {
  return _service;
}
// eslint-disable-next-line no-unused-vars
function enable() {
  _service.enable();
}
// eslint-disable-next-line no-unused-vars
function disable() {
  _service.disable();
}

// ESM (45+) default export. The `export` keyword is valid in the GNOME 45+
// module loader; older shells use the function entry points above.
VtxTrackExtension = class {
  enable() {
    _service.enable();
  }
  disable() {
    _service.disable();
  }
};

// eslint-disable-next-line no-undef
if (typeof module !== "undefined") {
  // CommonJS-ish environments (tooling/tests) — expose for inspection.
  module.exports = { VtxTrackService, focusedWindowInfo, OBJECT_PATH };
}
