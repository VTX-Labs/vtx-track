#!/usr/bin/env node
import {
  dayRange,
  fmtDuration,
  lastNDays,
  toDateString,
} from "@vtx-track/core";
import {
  DaemonClient,
  DaemonOfflineError,
  DEFAULT_HTTP_PORT,
  type GroupBy,
  type SummaryReport,
} from "@vtx-track/protocol";
import { parseArgs } from "node:util";
import { runService } from "./service-cmd.js";
import { readToken } from "./token.js";
import { BANNER, barRow, color, err, out, table } from "./ui.js";
import { VERSION } from "./version.js";

/** Exit codes (documented in the README). */
const EXIT = {
  ok: 0,
  usage: 1,
  offline: 2,
  error: 3,
} as const;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return EXIT.ok;
    case "version":
    case "--version":
    case "-v":
      out(VERSION);
      return EXIT.ok;
    case "start":
    case "stop":
    case "restart":
    case "install":
    case "uninstall":
    case "service":
      return runService(command === "service" ? rest : [command, ...rest]);
    case "status":
      return cmdStatus();
    case "today":
      return cmdSummary("today", rest);
    case "week":
      return cmdSummary("week", rest);
    case "project":
      return cmdGrouped("project", rest);
    case "language":
      return cmdGrouped("language", rest);
    case "apps":
      return cmdGrouped("app", rest);
    case "focus":
      return cmdFocus(rest);
    case "standup":
      return cmdStandup(rest);
    case "timesheet":
      return cmdTimesheet(rest);
    case "export":
      return cmdExport(rest);
    case "tray":
      return cmdTray();
    case "pause":
      return cmdControl("pause");
    case "resume":
      return cmdControl("resume");
    case "wipe":
      return cmdWipe(rest);
    case "config":
      return cmdConfig(rest);
    default:
      err(color.red(`Unknown command: ${command}`));
      err(`Run ${color.cyan("vtx-track help")} for usage.`);
      return EXIT.usage;
  }
}

function client(): DaemonClient {
  const port = Number(process.env.VTX_TRACK_PORT) || DEFAULT_HTTP_PORT;
  const token = readToken() ?? undefined;
  return new DaemonClient({
    baseUrl: `http://127.0.0.1:${port}`,
    ...(token ? { token } : {}),
  });
}

/** Wrap a daemon call so an offline daemon prints a friendly message. */
async function withDaemon<T>(
  fn: (c: DaemonClient) => Promise<T>,
): Promise<T | null> {
  try {
    return await fn(client());
  } catch (e) {
    if (e instanceof DaemonOfflineError) {
      err(color.yellow("The vtx-track daemon isn't running."));
      err(`Start it with ${color.cyan("vtx-track start")}.`);
      return null;
    }
    throw e;
  }
}

async function cmdStatus(): Promise<number> {
  const health = await withDaemon((c) => c.health());
  if (!health) return EXIT.offline;
  out();
  out(
    `  ${color.bold("vtx-track")} ${color.gray("v" + health.version)}  ` +
      (health.paused ? color.yellow("● paused") : color.green("● tracking")),
  );
  out(
    table([
      ["platform", health.platform],
      ["uptime", fmtDuration(health.uptimeMs)],
      [
        "window tracking",
        health.windowIdentificationLimited
          ? color.yellow("limited (Wayland?)")
          : color.green("full"),
      ],
    ]),
  );
  out();
  return EXIT.ok;
}

async function cmdSummary(
  period: "today" | "week",
  rest: string[],
): Promise<number> {
  const { values } = parse(rest, { by: { type: "string" } });
  const by = (values.by as GroupBy) ?? "category";
  const range =
    period === "today" ? dayRange(Date.now()) : lastNDays(Date.now(), 7);
  const report = await withDaemon((c) => c.summary(range, by));
  if (!report) return EXIT.offline;
  printSummary(period === "today" ? "Today" : "Last 7 days", report);
  return EXIT.ok;
}

async function cmdGrouped(by: GroupBy, rest: string[]): Promise<number> {
  const { values } = parse(rest, { days: { type: "string" } });
  const days = Number(values.days) || 1;
  const range = days <= 1 ? dayRange(Date.now()) : lastNDays(Date.now(), days);
  const report = await withDaemon((c) => c.summary(range, by));
  if (!report) return EXIT.offline;
  printSummary(
    `By ${by} · ${days === 1 ? "today" : `last ${days} days`}`,
    report,
  );
  return EXIT.ok;
}

function printSummary(title: string, report: SummaryReport): void {
  out();
  out(
    `  ${color.bold(title)}  ${color.gray("total " + fmtDuration(report.totalMs))}`,
  );
  out();
  if (report.rows.length === 0) {
    out(color.gray("  No activity recorded yet."));
    out();
    return;
  }
  const labelWidth = Math.min(
    24,
    report.rows.reduce((m, r) => Math.max(m, r.key.length), 0),
  );
  for (const row of report.rows.slice(0, 15)) {
    out(barRow(row.key, fmtDuration(row.durationMs), row.share, labelWidth));
  }
  out();
}

async function cmdFocus(rest: string[]): Promise<number> {
  const date = rest[0] ?? toDateString(Date.now());
  const f = await withDaemon((c) => c.focus(date));
  if (!f) return EXIT.offline;
  out();
  out(`  ${color.bold("Focus")} · ${date}`);
  out(
    table([
      ["active time", fmtDuration(f.totalActiveMs)],
      ["context switches", String(f.contextSwitches)],
      ["switches / hour", f.switchesPerHour.toFixed(1)],
      ["longest deep-work", fmtDuration(f.longestDeepWorkMs)],
      ["deep-work sessions", String(f.deepWorkSessions)],
    ]),
  );
  out();
  return EXIT.ok;
}

async function cmdStandup(rest: string[]): Promise<number> {
  const date = rest[0] ?? toDateString(Date.now());
  const s = await withDaemon((c) => c.standup(date));
  if (!s) return EXIT.offline;
  out();
  out(s.markdown);
  out();
  return EXIT.ok;
}

async function cmdTimesheet(rest: string[]): Promise<number> {
  const { values } = parse(rest, {
    by: { type: "string" },
    days: { type: "string" },
  });
  const by = (values.by as GroupBy) ?? "project";
  const days = Number(values.days) || 7;
  const t = await withDaemon((c) =>
    c.timesheet(lastNDays(Date.now(), days), by),
  );
  if (!t) return EXIT.offline;
  out();
  out(`  ${color.bold("Timesheet")} · last ${days} days · by ${by}`);
  out();
  for (const r of t.rows) {
    out(`  ${color.gray(r.key.padEnd(28))} ${r.hours.toFixed(2)} h`);
  }
  out();
  out(`  ${color.bold("Total")} ${t.totalHours.toFixed(2)} h`);
  out();
  return EXIT.ok;
}

async function cmdExport(rest: string[]): Promise<number> {
  const { values } = parse(rest, {
    format: { type: "string" },
    days: { type: "string" },
  });
  const days = Number(values.days) || 30;
  const format = values.format === "csv" ? "csv" : "json";
  const segments = await withDaemon((c) =>
    c.timeline(lastNDays(Date.now(), days)),
  );
  if (!segments) return EXIT.offline;

  if (format === "csv") {
    out(
      "started_at,ended_at,duration_ms,app,category,state,project,branch,language",
    );
    for (const s of segments) {
      out(
        [
          new Date(s.startedAt).toISOString(),
          new Date(s.endedAt).toISOString(),
          s.durationMs,
          csv(s.app),
          csv(s.category),
          s.state,
          csv(s.vscode?.workspace ?? ""),
          csv(s.vscode?.branch ?? ""),
          csv(s.vscode?.language ?? ""),
        ].join(","),
      );
    }
  } else {
    out(JSON.stringify(segments, null, 2));
  }
  return EXIT.ok;
}

async function cmdControl(action: "pause" | "resume"): Promise<number> {
  const health = await withDaemon((c) =>
    action === "pause" ? c.pause() : c.resume(),
  );
  if (!health) return EXIT.offline;
  out(
    action === "pause"
      ? color.yellow("Tracking paused.")
      : color.green("Tracking resumed."),
  );
  return EXIT.ok;
}

/**
 * Launch the system-tray companion. Runs in the foreground (Ctrl+C to quit);
 * the OS service can launch it at login. The tray package is optional — if it
 * isn't installed we explain how to add it rather than crash.
 */
async function cmdTray(): Promise<number> {
  let TrayCtor: (new () => { start(): Promise<void> }) | undefined;
  try {
    // Variable specifier keeps this optional dependency out of the build's
    // static module graph.
    const specifier = "@vtx-track/tray";
    const mod = (await import(specifier)) as {
      Tray?: new () => { start(): Promise<void> };
    };
    TrayCtor = mod.Tray;
  } catch {
    TrayCtor = undefined;
  }
  if (!TrayCtor) {
    err(color.yellow("The tray companion isn't built."));
    err(`Build the workspace with ${color.cyan("pnpm build")}, then retry.`);
    return EXIT.error;
  }
  out(color.gray("vtx-track tray running - close this window or press Ctrl+C to quit."));
  await new TrayCtor().start();
  // Keep the process alive for the tray's lifetime.
  await new Promise<never>(() => {});
  return EXIT.ok;
}

async function cmdWipe(rest: string[]): Promise<number> {
  const { values } = parse(rest, { yes: { type: "boolean" } });
  if (!values.yes) {
    err(color.yellow("This deletes ALL tracked data and cannot be undone."));
    err(`Re-run with ${color.cyan("vtx-track wipe --yes")} to confirm.`);
    return EXIT.usage;
  }
  const res = await withDaemon((c) => c.wipe(true));
  if (!res) return EXIT.offline;
  out(color.green(`Deleted ${res.deleted} segments. All data wiped.`));
  return EXIT.ok;
}

async function cmdConfig(rest: string[]): Promise<number> {
  const [sub, ...args] = rest;
  if (sub === "get" || sub === undefined) {
    const cfg = await withDaemon((c) => c.getConfig());
    if (!cfg) return EXIT.offline;
    out(JSON.stringify(cfg, null, 2));
    return EXIT.ok;
  }
  if (sub === "set") {
    const { values } = parse(args, {
      idle: { type: "string" },
      redaction: { type: "string" },
      deny: { type: "string", multiple: true },
    });
    const patch: Record<string, unknown> = {};
    if (values.idle) patch.idleThresholdSeconds = Number(values.idle);
    if (values.redaction) patch.redaction = values.redaction;
    if (values.deny) patch.denylist = values.deny;
    const cfg = await withDaemon((c) => c.setConfig(patch));
    if (!cfg) return EXIT.offline;
    out(color.green("Config updated."));
    out(JSON.stringify(cfg, null, 2));
    return EXIT.ok;
  }
  err(color.red(`Unknown config subcommand: ${sub}`));
  return EXIT.usage;
}

type ParseOptions = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

function parse(args: string[], options: ParseOptions): ReturnType<typeof parseArgs> {
  return parseArgs({ args, options, allowPositionals: true, strict: false });
}

function csv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function printHelp(): void {
  out(BANNER);
  out();
  out(
    `  ${color.bold("vtx-track")} ${color.gray("v" + VERSION)} — local-first time tracking for your whole machine.`,
  );
  out();
  out(color.bold("  Tracking"));
  out(
    table([
      ["start", "install + start the background daemon (service)"],
      ["stop", "stop the daemon"],
      ["status", "show daemon status and capabilities"],
      ["pause / resume", "pause or resume tracking"],
      ["tray", "run the system-tray companion (status, pause, dashboard)"],
    ]),
  );
  out();
  out(color.bold("  Reports"));
  out(
    table([
      ["today [--by app|category|project|language]", "today's time"],
      ["week  [--by …]", "last 7 days"],
      ["apps | project | language [--days N]", "grouped breakdown"],
      ["focus [YYYY-MM-DD]", "context-switching & deep-work metrics"],
      ["standup [YYYY-MM-DD]", "markdown standup summary"],
      ["timesheet [--by project --days N]", "billable hours rollup"],
    ]),
  );
  out();
  out(color.bold("  Data"));
  out(
    table([
      ["export [--format json|csv --days N]", "export segments to stdout"],
      [
        "config get | set [--idle N --redaction M --deny X]",
        "view/change config",
      ],
      ["wipe --yes", "delete ALL tracked data"],
    ]),
  );
  out();
  out(
    color.gray(
      "  All data stays on your machine. Docs: https://github.com/VTX-Labs/vtx-track",
    ),
  );
  out();
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    err(color.red(`Error: ${e?.message ?? e}`));
    process.exit(EXIT.error);
  });
