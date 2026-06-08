import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Server as NetServer } from "node:net";
import type { Config } from "@vtx-track/protocol";

/** A static-file handler: returns true if it served the request. */
type StaticHandler = (req: IncomingMessage, res: ServerResponse) => boolean;
import {
  Store,
  loadConfig,
  mergeConfig,
  saveConfig,
  socketPath,
} from "@vtx-track/core";
import { createMonitor, type ActivityMonitor } from "@vtx-track/platform";
import { Tracker } from "./tracker.js";
import { createHttpServer } from "./http.js";
import { createIpcServer } from "./ipc.js";
import { ensureToken } from "./token.js";
import { ensureSqliteBinding } from "./native-ensure.js";

export interface DaemonOptions {
  /** Override the loaded config (mainly for tests). */
  config?: Config;
  /** Inject a monitor (mainly for tests). Defaults to the native monitor. */
  monitor?: ActivityMonitor;
  /** Inject a store (mainly for tests). Defaults to a SQLite store at config.dbPath. */
  store?: Store;
  /** Serve the bundled dashboard. Defaults to true. */
  serveDashboard?: boolean;
}

/**
 * The daemon: starts the tracker, the localhost HTTP API, and the IPC socket;
 * exposes config get/set/wipe; and tears everything down cleanly on stop.
 */
export class Daemon {
  readonly config: Config;
  private readonly store: Store;
  private readonly monitor: ActivityMonitor;
  private readonly tracker: Tracker;
  private readonly token: string;
  private http: Server | null = null;
  private ipc: NetServer | null = null;
  private readonly startedAt = Date.now();
  private readonly serveDashboard: boolean;

  private constructor(opts: DaemonOptions, monitor: ActivityMonitor) {
    this.config = opts.config ?? loadConfig();
    this.store = opts.store ?? new Store(this.config.dbPath);
    this.monitor = monitor;
    this.token = ensureToken();
    this.serveDashboard = opts.serveDashboard ?? true;
    this.tracker = new Tracker({
      monitor: this.monitor,
      store: this.store,
      config: this.config,
    });
  }

  /** Construct a daemon, resolving the native monitor if none injected. */
  static async create(opts: DaemonOptions = {}): Promise<Daemon> {
    // Self-heal the SQLite native binding if a scripts-disabled install left it
    // missing. Skipped when a store is injected (tests) — nothing to open.
    if (!opts.store) {
      const ok = await ensureSqliteBinding((msg) =>
        process.stdout.write(`${msg}\n`),
      );
      if (!ok) {
        throw new Error(
          "vtx-track: the SQLite native binding (better-sqlite3) is missing " +
            "and could not be fetched automatically. Run " +
            "`node scripts/native-bootstrap.mjs` from the install directory, " +
            "or reinstall with install scripts enabled. See README → " +
            "Troubleshooting.",
        );
      }
    }
    const monitor = opts.monitor ?? (await createMonitor());
    return new Daemon(opts, monitor);
  }

  /** Start tracking and bind the servers. Resolves once listening. */
  async start(): Promise<{ httpPort: number }> {
    this.tracker.start();

    const serveStatic = this.serveDashboard
      ? await this.tryLoadDashboard()
      : undefined;

    this.http = createHttpServer({
      tracker: this.tracker,
      token: this.token,
      getConfig: () => this.config,
      setConfig: (patch) => this.setConfig(patch),
      wipe: () => this.store.wipe(),
      startedAt: this.startedAt,
      capabilities: {
        platform: this.monitor.capabilities.platform,
        windowIdentificationLimited:
          !this.monitor.capabilities.canIdentifyWindow,
      },
      ...(serveStatic ? { serveStatic } : {}),
    });
    this.ipc = createIpcServer({ tracker: this.tracker });

    await this.listen();
    return { httpPort: this.config.httpPort };
  }

  /** The control token (callers on the same machine read it from disk). */
  getToken(): string {
    return this.token;
  }

  /** Stop everything and flush. */
  async stop(): Promise<void> {
    this.tracker.stop();
    await Promise.all([
      this.http ? closeServer(this.http) : Promise.resolve(),
      this.ipc ? closeServer(this.ipc) : Promise.resolve(),
    ]);
    this.store.close();
  }

  private setConfig(patch: Partial<Config>): Config {
    const merged = mergeConfig(this.config, patch);
    Object.assign(this.config, merged);
    this.tracker.applyConfig(this.config);
    saveConfig(this.config);
    return this.config;
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const http = this.http;
      const ipc = this.ipc;
      if (!http || !ipc) return reject(new Error("servers not created"));
      http.once("error", reject);
      http.listen(this.config.httpPort, "127.0.0.1", () => {
        ipc.once("error", reject);
        ipc.listen(socketPath(), () => resolve());
      });
    });
  }

  /**
   * Attempt to load the bundled dashboard's static handler. The dashboard
   * package, when installed, exports a `createStaticHandler` that serves its
   * built assets. If it isn't available, the daemon simply runs without a UI.
   */
  private async tryLoadDashboard(): Promise<StaticHandler | undefined> {
    try {
      // A variable specifier keeps this optional dependency out of the build's
      // static module graph — the dashboard package is loaded only if installed.
      const specifier = "@vtx-track/dashboard";
      const mod = (await import(specifier)) as {
        createStaticHandler?: () => StaticHandler;
      };
      return mod.createStaticHandler?.();
    } catch {
      return undefined;
    }
  }
}

function closeServer(server: Server | NetServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
