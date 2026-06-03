import {
  LaunchdManager,
  SystemdManager,
  WindowsTaskManager,
} from "./managers.js";
import { serviceSpec } from "./resolve.js";
import type { ServiceManager, ServiceState } from "./types.js";

export type { ServiceManager, ServiceState, ServiceSpec } from "./types.js";
export { SERVICE_LABEL } from "./types.js";
export {
  launchdPlist,
  systemdUnit,
  windowsTaskXml,
} from "./definitions.js";
export { serviceSpec, resolveDaemonPath } from "./resolve.js";

/** A manager that reports "unsupported" on unknown platforms. */
class UnsupportedManager implements ServiceManager {
  readonly manager = "unsupported" as const;
  async install(): Promise<void> {
    throw new Error(`Service install is not supported on ${process.platform}.`);
  }
  async uninstall(): Promise<void> {}
  async start(): Promise<void> {
    throw new Error(`Service start is not supported on ${process.platform}.`);
  }
  async stop(): Promise<void> {}
  async status(): Promise<ServiceState> {
    return { installed: false, running: false, manager: "unsupported" };
  }
}

/** Resolve the service manager for the current platform. */
export function createServiceManager(): ServiceManager {
  const spec = serviceSpec();
  switch (process.platform) {
    case "darwin":
      return new LaunchdManager(spec);
    case "linux":
      return new SystemdManager(spec);
    case "win32":
      return new WindowsTaskManager(spec);
    default:
      return new UnsupportedManager();
  }
}

/** Install and enable the daemon as a background service. */
export function installService(): Promise<void> {
  return createServiceManager().install();
}

/** Stop and remove the service. */
export function uninstallService(): Promise<void> {
  return createServiceManager().uninstall();
}

/** Start the (already installed) service. */
export function startService(): Promise<void> {
  return createServiceManager().start();
}

/** Stop the running service. */
export function stopService(): Promise<void> {
  return createServiceManager().stop();
}

/** Query install/run state. */
export function serviceStatus(): Promise<ServiceState> {
  return createServiceManager().status();
}

export {
  LaunchdManager,
  SystemdManager,
  WindowsTaskManager,
} from "./managers.js";
