import { describe, expect, it } from "vitest";
import {
  launchdPlist,
  systemdUnit,
  windowsTaskXml,
} from "../src/definitions.js";
import type { ServiceSpec } from "../src/types.js";

const spec: ServiceSpec = {
  nodePath: "/usr/local/bin/node",
  daemonPath: "/opt/vtx-track/dist/main.js",
  logPath: "/home/u/.vtx-track/daemon.log",
  label: "dev.vtxlabs.track",
};

describe("launchdPlist", () => {
  it("is valid plist referencing node + daemon", () => {
    const plist = launchdPlist(spec);
    expect(plist).toContain("<?xml");
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("dev.vtxlabs.track");
    expect(plist).toContain(spec.nodePath);
    expect(plist).toContain(spec.daemonPath);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });
});

describe("systemdUnit", () => {
  it("is a valid user unit that restarts on failure", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain(`ExecStart=${spec.nodePath} ${spec.daemonPath}`);
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
  });
});

describe("windowsTaskXml", () => {
  it("is a logon-triggered task running node + daemon", () => {
    const xml = windowsTaskXml(spec);
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain(`<Command>${spec.nodePath}</Command>`);
    expect(xml).toContain(spec.daemonPath);
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<Hidden>true</Hidden>");
  });
});
