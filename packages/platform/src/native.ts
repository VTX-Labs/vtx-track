/**
 * Guarded loaders for the native addons. Each returns `null` if the addon is
 * not installed or fails to load, so the platform layer can fall back to a
 * degraded monitor rather than crashing the daemon.
 */

/** The subset of `@paymoapp/active-window` we use. */
export interface ActiveWindowAddon {
  initialize(opts?: { osxRunLoop?: "all" | "get" }): void;
  requestPermissions?(): boolean;
  getActiveWindow(): NativeWindowInfo | null;
  subscribe(cb: (info: NativeWindowInfo | null) => void): number;
  unsubscribe(watchId: number): void;
}

export interface NativeWindowInfo {
  title: string;
  application: string;
  path: string;
  pid: number;
  icon?: string;
}

/** The subset of `@paymoapp/real-idle` we use. */
export interface RealIdleAddon {
  getIdleSeconds(): number;
  getLocked(): boolean;
  getIdlePrevented(): boolean;
  getIdleState(
    thresholdSeconds: number,
  ): "active" | "idlePrevented" | "idle" | "locked" | "unknown";
}

/**
 * Resolve the real addon object from an ESM/CJS interop module. These native
 * packages variously expose their API on the module root, on `.default`, or on
 * a named export (e.g. `ActiveWindow`). We probe the likely shapes and accept
 * the first that has the expected method.
 */
function resolveAddon<T>(mod: Record<string, unknown>, method: keyof T): T | null {
  const candidates: unknown[] = [
    mod,
    mod.default,
    mod.ActiveWindow,
    mod.RealIdle,
    (mod.default as Record<string, unknown> | undefined)?.default,
    (mod.default as Record<string, unknown> | undefined)?.ActiveWindow,
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof (candidate as Record<string, unknown>)[method as string] ===
        "function"
    ) {
      return candidate as T;
    }
  }
  return null;
}

/** Load the active-window addon, or null if unavailable. */
export async function loadActiveWindow(): Promise<ActiveWindowAddon | null> {
  try {
    const mod = (await import("@paymoapp/active-window")) as Record<
      string,
      unknown
    >;
    return resolveAddon<ActiveWindowAddon>(mod, "getActiveWindow");
  } catch {
    return null;
  }
}

/** Load the real-idle addon, or null if unavailable. */
export async function loadRealIdle(): Promise<RealIdleAddon | null> {
  try {
    const mod = (await import("@paymoapp/real-idle")) as Record<string, unknown>;
    return resolveAddon<RealIdleAddon>(mod, "getIdleState");
  } catch {
    return null;
  }
}
