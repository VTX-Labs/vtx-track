import {
  installService,
  uninstallService,
  startService,
  stopService,
  serviceStatus,
} from "@vtx-track/service";
import { color, err, out } from "./ui.js";

/**
 * Handle the service lifecycle subcommands. `args[0]` is the action; the bare
 * `start`/`stop`/etc. top-level commands forward here too.
 */
export async function runService(args: string[]): Promise<number> {
  const action = args[0] ?? "status";
  try {
    switch (action) {
      case "install":
        await installService();
        out(color.green("Service installed and started. Tracking is on."));
        return 0;
      case "uninstall":
        await uninstallService();
        out(color.green("Service stopped and uninstalled."));
        return 0;
      case "start": {
        // `start` installs-if-needed then starts — the friendly one-liner.
        const status = await serviceStatus();
        if (!status.installed) await installService();
        else await startService();
        out(color.green("vtx-track is tracking."));
        return 0;
      }
      case "stop":
        await stopService();
        out(color.green("vtx-track stopped."));
        return 0;
      case "restart":
        await stopService();
        await startService();
        out(color.green("vtx-track restarted."));
        return 0;
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
