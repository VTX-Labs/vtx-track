import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  IdleReading,
  WindowSample,
} from "@vtx-track/protocol";
import { Store, defaultConfig } from "@vtx-track/core";
import type {
  ActivityMonitor,
  PlatformCapabilities,
  WindowChangeListener,
} from "@vtx-track/platform";

const WIN_CAPS: PlatformCapabilities = {
  platform: "win32",
  canIdentifyWindow: true,
  canReadTitles: true,
  canReadIdle: true,
  canDetectIdlePrevented: false,
  canDetectLock: false,
};

/** A scriptable monitor for tests: set the current window/idle, fire changes. */
export class FakeMonitor implements ActivityMonitor {
  readonly capabilities = WIN_CAPS;
  window: WindowSample | null = null;
  idle: IdleReading = { state: "active", idleSeconds: 0, locked: false };
  private listener: WindowChangeListener | null = null;

  start(): void {}
  stop(): void {}
  getActiveWindow(): WindowSample | null {
    return this.window;
  }
  getIdle(): IdleReading {
    return this.idle;
  }
  onWindowChange(listener: WindowChangeListener): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  /** Simulate a focus change. */
  focus(window: WindowSample | null): void {
    this.window = window;
    this.listener?.(window);
  }
}

export function win(app: string, title = "", pid = 100): WindowSample {
  return { app, title, exePath: `C:/Apps/${app}.exe`, pid };
}

/** A temp store with cleanup, for daemon/tracker tests. */
export function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vtx-track-daemon-"));
  const store = new Store(join(dir, "t.db"));
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export { defaultConfig };
