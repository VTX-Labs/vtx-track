/** Cross-platform service management for the vtx-track daemon. */

/** Current state of the installed service. */
export interface ServiceState {
  installed: boolean;
  running: boolean;
  /** Which OS mechanism manages the service. */
  manager: "windows-task" | "launchd" | "systemd" | "unsupported";
}

/** A platform service manager. Implementations shell out to the OS tool. */
export interface ServiceManager {
  readonly manager: ServiceState["manager"];
  install(): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<ServiceState>;
}

/** Inputs needed to render a service definition. */
export interface ServiceSpec {
  /** Absolute path to the node executable. */
  nodePath: string;
  /** Absolute path to the daemon entry script (dist/main.js). */
  daemonPath: string;
  /** Absolute path to the log file. */
  logPath: string;
  /** Label / service name, e.g. "dev.vtxlabs.track". */
  label: string;
}

/** The canonical service label/name used across platforms. */
export const SERVICE_LABEL = "dev.vtxlabs.track";
