import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import SysTrayDefault, {
  type ClickEvent,
  type MenuItem,
} from "systray2";
import { DaemonClient, DEFAULT_HTTP_PORT } from "@vtx-track/protocol";
import { tokenPath } from "@vtx-track/core";
import { TRAY_ICON_ICO_BASE64, TRAY_ICON_PNG_BASE64 } from "./icon.js";

// systray2 is a CJS module whose `module.exports` is the SysTray class. Under
// Node's ESM interop the default import is double-wrapped — the real
// constructor (carrying `static separator`) sits at `default` or
// `default.default` depending on the loader. Resolve it at runtime, and keep
// the static type from the package's own .d.ts.
type SysTrayCtor = typeof import("systray2").default;
type SysTrayInstance = InstanceType<SysTrayCtor>;

function resolveSysTrayCtor(mod: unknown): SysTrayCtor {
  const candidates = [
    mod,
    (mod as { default?: unknown })?.default,
    (mod as { default?: { default?: unknown } })?.default?.default,
  ];
  for (const c of candidates) {
    if (typeof c === "function") return c as SysTrayCtor;
  }
  throw new Error("systray2: could not resolve the SysTray constructor");
}

const SysTray = resolveSysTrayCtor(SysTrayDefault);

/** Snapshot of what the tray needs to render its menu. */
export interface TrayState {
  online: boolean;
  paused: boolean;
  version?: string;
  platform?: string;
  windowIdentificationLimited?: boolean;
}

/** The daemon surface the tray depends on — narrowed for testability. */
export interface TrayDaemon {
  health(): Promise<{
    paused: boolean;
    version: string;
    platform: string;
    windowIdentificationLimited: boolean;
  }>;
  pause(): Promise<unknown>;
  resume(): Promise<unknown>;
}

export interface TrayOptions {
  /** Daemon client. Defaults to one built from the local port + token. */
  daemon?: TrayDaemon;
  /** Dashboard URL to open. Defaults to the local daemon's dashboard. */
  dashboardUrl?: string;
  /** Poll interval for refreshing status, ms. Defaults to 5000. */
  pollMs?: number;
  /** Open a URL in the default browser. Injectable for tests. */
  openUrl?: (url: string) => void;
}

/** Read the daemon control token from disk, or undefined if not present. */
function readToken(): string | undefined {
  try {
    const t = readFileSync(tokenPath(), "utf8").trim();
    return t.length > 0 ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Default daemon client built from the local port and on-disk token. */
function defaultDaemon(): TrayDaemon {
  const port = Number(process.env.VTX_TRACK_PORT) || DEFAULT_HTTP_PORT;
  const token = readToken();
  return new DaemonClient({
    baseUrl: `http://127.0.0.1:${port}`,
    ...(token ? { token } : {}),
  });
}

/** Open a URL with the platform's default handler. */
function defaultOpenUrl(url: string): void {
  const cmd =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };
  try {
    spawn(cmd.file, cmd.args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* best effort — nothing else we can do from a tray */
  }
}

/**
 * Build the menu-item list for a given state. Exposed for testing so we can
 * assert the labels/enabled-state without spawning a real tray process.
 */
export function buildMenuItems(state: TrayState): MenuItem[] {
  const statusLine = !state.online
    ? "● daemon offline"
    : state.paused
      ? "❙❙ paused"
      : "● tracking";

  const toggleTitle = state.paused ? "Resume tracking" : "Pause tracking";

  const items: MenuItem[] = [
    { title: statusLine, tooltip: "vtx-track status", enabled: false },
    SysTray.separator,
    {
      title: toggleTitle,
      tooltip: "Pause or resume tracking",
      enabled: state.online,
      checked: false,
    },
    {
      title: "Open dashboard",
      tooltip: "Open the local dashboard in your browser",
      enabled: true,
      checked: false,
    },
    SysTray.separator,
    {
      title: "Quit tray",
      tooltip: "Close this tray icon (tracking keeps running)",
      enabled: true,
      checked: false,
    },
  ];
  return items;
}

const ICON =
  process.platform === "win32" ? TRAY_ICON_ICO_BASE64 : TRAY_ICON_PNG_BASE64;

/**
 * The vtx-track tray companion. Renders a tray icon with live status and a
 * small menu (pause/resume, open dashboard, quit). It owns no tracking state —
 * it is a thin remote control for the daemon over its localhost API, so closing
 * the tray never stops tracking.
 */
export class Tray {
  private readonly daemon: TrayDaemon;
  private readonly dashboardUrl: string;
  private readonly pollMs: number;
  private readonly openUrl: (url: string) => void;
  private sys: SysTrayInstance | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: TrayState = { online: false, paused: false };

  constructor(opts: TrayOptions = {}) {
    this.daemon = opts.daemon ?? defaultDaemon();
    const port = Number(process.env.VTX_TRACK_PORT) || DEFAULT_HTTP_PORT;
    this.dashboardUrl = opts.dashboardUrl ?? `http://127.0.0.1:${port}/`;
    this.pollMs = opts.pollMs ?? 5000;
    this.openUrl = opts.openUrl ?? defaultOpenUrl;
  }

  /** Start the tray: spawn the icon, wire clicks, begin status polling. */
  async start(): Promise<void> {
    await this.refreshState();
    this.sys = new SysTray({
      menu: {
        icon: ICON,
        isTemplateIcon: process.platform === "darwin",
        title: "vtx-track",
        tooltip: "vtx-track — local-first time tracking",
        items: buildMenuItems(this.state),
      },
      debug: false,
      copyDir: true,
    });

    void this.sys.onClick((action: ClickEvent) => {
      void this.handleClick(action.item.title);
    });

    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop polling and tear down the tray icon. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.sys) await this.sys.kill(false);
    this.sys = null;
  }

  /** Handle a menu click by its title. Exposed for testing. */
  async handleClick(title: string): Promise<void> {
    if (title.startsWith("Pause")) {
      try {
        await this.daemon.pause();
      } catch {
        /* offline — next poll reflects reality */
      }
      await this.tick();
    } else if (title.startsWith("Resume")) {
      try {
        await this.daemon.resume();
      } catch {
        /* offline */
      }
      await this.tick();
    } else if (title === "Open dashboard") {
      this.openUrl(this.dashboardUrl);
    } else if (title === "Quit tray") {
      await this.stop();
      process.exit(0);
    }
  }

  /** Re-read daemon health into local state. Never throws. */
  private async refreshState(): Promise<void> {
    try {
      const h = await this.daemon.health();
      this.state = {
        online: true,
        paused: h.paused,
        version: h.version,
        platform: h.platform,
        windowIdentificationLimited: h.windowIdentificationLimited,
      };
    } catch {
      this.state = { online: false, paused: this.state.paused };
    }
  }

  /** Refresh state and push an updated menu to the tray. */
  private async tick(): Promise<void> {
    await this.refreshState();
    if (!this.sys) return;
    try {
      await this.sys.sendAction({
        type: "update-menu",
        menu: {
          icon: ICON,
          isTemplateIcon: process.platform === "darwin",
          title: "vtx-track",
          tooltip: "vtx-track — local-first time tracking",
          items: buildMenuItems(this.state),
        },
      });
    } catch {
      /* tray process gone — stop quietly */
    }
  }
}
