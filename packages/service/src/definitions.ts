import type { ServiceSpec } from "./types.js";

/**
 * Render a macOS launchd LaunchAgent plist. Loaded with `launchctl bootstrap`,
 * `RunAtLoad` + `KeepAlive` keep the daemon alive across logins/crashes.
 */
export function launchdPlist(spec: ServiceSpec): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${spec.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${spec.nodePath}</string>
    <string>${spec.daemonPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${spec.logPath}</string>
  <key>StandardErrorPath</key>
  <string>${spec.logPath}</string>
</dict>
</plist>
`;
}

/**
 * Render a Linux systemd **user** unit. Installed under
 * `~/.config/systemd/user/` and enabled with `systemctl --user enable --now`.
 */
export function systemdUnit(spec: ServiceSpec): string {
  return `[Unit]
Description=vtx-track time-tracking daemon
After=graphical-session.target

[Service]
Type=simple
ExecStart=${spec.nodePath} ${spec.daemonPath}
Restart=on-failure
RestartSec=5
StandardOutput=append:${spec.logPath}
StandardError=append:${spec.logPath}

[Install]
WantedBy=default.target
`;
}

/**
 * Render a Windows Task Scheduler definition XML. Registered with `schtasks
 * /Create /XML`, it runs at logon and restarts on failure — a no-admin path to
 * an always-on background process.
 */
export function windowsTaskXml(spec: ServiceSpec): string {
  // schtasks expects UTF-16; the manager writes it with the right encoding.
  const cmd = spec.nodePath;
  const args = `"${spec.daemonPath}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>vtx-track time-tracking daemon</Description>
    <URI>\\${spec.label}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${cmd}</Command>
      <Arguments>${args}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}
