import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { dataDir } from "@vtx-track/core";
import { launchdPlist, systemdUnit, windowsTaskXml } from "./definitions.js";
import type { ServiceManager, ServiceSpec, ServiceState } from "./types.js";

const exec = promisify(execFile);

/** Run a command, returning {stdout, code}; never throws on non-zero exit. */
async function run(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await exec(cmd, args, {
      windowsHide: true,
      shell: false,
    });
    return { stdout, stderr, ok: true };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", ok: false };
  }
}

// ── macOS (launchd) ─────────────────────────────────────────────────────────

export class LaunchdManager implements ServiceManager {
  readonly manager = "launchd" as const;
  private readonly plistPath = join(
    homedir(),
    "Library",
    "LaunchAgents",
    "dev.vtxlabs.track.plist",
  );

  constructor(private readonly spec: ServiceSpec) {}

  async install(): Promise<void> {
    mkdirSync(dirname(this.plistPath), { recursive: true });
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(this.plistPath, launchdPlist(this.spec), "utf8");
    await this.start();
  }

  async uninstall(): Promise<void> {
    await this.stop();
    if (existsSync(this.plistPath)) rmSync(this.plistPath, { force: true });
  }

  async start(): Promise<void> {
    const uid = process.getuid?.() ?? 0;
    await run("launchctl", ["bootstrap", `gui/${uid}`, this.plistPath]);
    await run("launchctl", ["enable", `gui/${uid}/${this.spec.label}`]);
  }

  async stop(): Promise<void> {
    const uid = process.getuid?.() ?? 0;
    await run("launchctl", ["bootout", `gui/${uid}/${this.spec.label}`]);
  }

  async status(): Promise<ServiceState> {
    const installed = existsSync(this.plistPath);
    const { stdout } = await run("launchctl", ["list"]);
    return {
      installed,
      running: stdout.includes(this.spec.label),
      manager: this.manager,
    };
  }
}

// ── Linux (systemd --user) ───────────────────────────────────────────────────

export class SystemdManager implements ServiceManager {
  readonly manager = "systemd" as const;
  private readonly unitPath = join(
    homedir(),
    ".config",
    "systemd",
    "user",
    "vtx-track.service",
  );

  constructor(private readonly spec: ServiceSpec) {}

  async install(): Promise<void> {
    mkdirSync(dirname(this.unitPath), { recursive: true });
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(this.unitPath, systemdUnit(this.spec), "utf8");
    await run("systemctl", ["--user", "daemon-reload"]);
    await run("systemctl", ["--user", "enable", "--now", "vtx-track.service"]);
  }

  async uninstall(): Promise<void> {
    await run("systemctl", ["--user", "disable", "--now", "vtx-track.service"]);
    if (existsSync(this.unitPath)) rmSync(this.unitPath, { force: true });
    await run("systemctl", ["--user", "daemon-reload"]);
  }

  async start(): Promise<void> {
    await run("systemctl", ["--user", "start", "vtx-track.service"]);
  }

  async stop(): Promise<void> {
    await run("systemctl", ["--user", "stop", "vtx-track.service"]);
  }

  async status(): Promise<ServiceState> {
    const installed = existsSync(this.unitPath);
    const { stdout } = await run("systemctl", [
      "--user",
      "is-active",
      "vtx-track.service",
    ]);
    return {
      installed,
      running: stdout.trim() === "active",
      manager: this.manager,
    };
  }
}

// ── Windows (Task Scheduler) ─────────────────────────────────────────────────

export class WindowsTaskManager implements ServiceManager {
  readonly manager = "windows-task" as const;
  private readonly taskName = "vtx-track";
  private readonly xmlPath = join(dataDir(), "vtx-track-task.xml");

  constructor(private readonly spec: ServiceSpec) {}

  async install(): Promise<void> {
    mkdirSync(dataDir(), { recursive: true });
    // Task Scheduler XML must be UTF-16LE with a BOM.
    writeFileSync(this.xmlPath, windowsTaskXml(this.spec), { encoding: "utf16le" });
    await run("schtasks", [
      "/Create",
      "/TN",
      this.taskName,
      "/XML",
      this.xmlPath,
      "/F",
    ]);
    await this.start();
  }

  async uninstall(): Promise<void> {
    await run("schtasks", ["/Delete", "/TN", this.taskName, "/F"]);
    if (existsSync(this.xmlPath)) rmSync(this.xmlPath, { force: true });
  }

  async start(): Promise<void> {
    await run("schtasks", ["/Run", "/TN", this.taskName]);
  }

  async stop(): Promise<void> {
    await run("schtasks", ["/End", "/TN", this.taskName]);
  }

  async status(): Promise<ServiceState> {
    const { stdout, ok } = await run("schtasks", [
      "/Query",
      "/TN",
      this.taskName,
      "/FO",
      "LIST",
    ]);
    return {
      installed: ok,
      running: /Status:\s*Running/i.test(stdout),
      manager: this.manager,
    };
  }
}
