import {
  installService,
  uninstallService,
  startService,
  stopService,
  serviceStatus,
} from "@vtx-track/service";
import { DaemonClient, DEFAULT_HTTP_PORT } from "@vtx-track/protocol";
import { color, err, out } from "./ui.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the daemon's /health endpoint until it responds or we time out. The OS
 * service manager reports "started" the instant it launches the process, but
 * the daemon may still be fetching its native binding or binding the port — or
 * may have crashed. We confirm it actually came up before claiming success.
 */
async function waitForDaemon(timeoutMs = 15_000): Promise<boolean> {
  const port = Number(process.env.VTX_TRACK_PORT) || DEFAULT_HTTP_PORT;
  const client = new DaemonClient({ baseUrl: `http://127.0.0.1:${port}` });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.isOnline()) return true;
    await sleep(300);
  }
  return false;
}

/** Print the "couldn't confirm" message shared by start/restart/install. */
function reportNotConfirmed(): void {
  err(
    color.yellow(
      "vtx-track was launched, but the daemon didn't come online in time.",
    ),
  );
  err(
    color.gray(
      "Check the log at ~/.vtx-track/daemon.log, or run the daemon directly " +
        "to see the error. First start can be slower while native binaries " +
        "are fetched.",
    ),
  );
}

/**
 * Handle the service lifecycle subcommands. `args[0]` is the action; the bare
 * `start`/`stop`/etc. top-level commands forward here too.
 */
export async function runService(args: string[]): Promise<number> {
  const action = args[0] ?? "status";
  try {
    switch (action) {
      case "install": {
        await installService();
        if (await waitForDaemon()) {
          out(color.green("Service installed and started. Tracking is on."));
          return 0;
        }
        reportNotConfirmed();
        return 3;
      }
      case "uninstall":
        await uninstallService();
        out(color.green("Service stopped and uninstalled."));
        return 0;
      case "start": {
        // `start` installs-if-needed then starts — the friendly one-liner.
        const status = await serviceStatus();
        if (!status.installed) await installService();
        else await startService();
        if (await waitForDaemon()) {
          out(color.green("vtx-track is tracking."));
          return 0;
        }
        reportNotConfirmed();
        return 3;
      }
      case "stop":
        await stopService();
        out(color.green("vtx-track stopped."));
        return 0;
      case "restart": {
        await stopService();
        await startService();
        if (await waitForDaemon()) {
          out(color.green("vtx-track restarted."));
          return 0;
        }
        reportNotConfirmed();
        return 3;
      }
      case "status": {
        const status = await serviceStatus();
        out(
          `  service: ${status.installed ? color.green("installed") : color.gray("not installed")}` +
            `  ${status.running ? color.green("running") : color.gray("stopped")}`,
        );
        out(color.gray(`  manager: ${status.manager}`));
        return 0;
      }
      default:
        err(color.red(`Unknown service action: ${action}`));
        return 1;
    }
  } catch (e) {
    err(color.red(`Service error: ${(e as Error).message}`));
    err(
      color.gray(
        "On some systems installing a service needs elevated privileges. " +
          "See README → Service install.",
      ),
    );
    return 3;
  }
}
