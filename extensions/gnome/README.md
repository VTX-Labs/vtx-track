# vtx-track GNOME Shell extension

GNOME on Wayland deliberately exposes **no** unprivileged "active window" API, so
the vtx-track daemon can't see which app you're using the way it can on X11,
sway, or Hyprland. This small, read-only extension closes that gap.

It registers a private session-bus interface,
`org.gnome.Shell.Extensions.VtxTrack`, with one method — `GetFocusedWindow()` —
that returns the focused window as `"app|title|pid"`. The daemon calls it via
`gdbus` (see `packages/platform/src/wayland/gnome.ts`).

**Privacy:** the extension stores nothing and sends nothing anywhere. It only
answers, when asked by your local daemon, which window is focused right now —
exactly the same information vtx-track already records on every other platform.

## Install

```sh
# copy into the per-user extensions dir
mkdir -p ~/.local/share/gnome-shell/extensions/vtx-track@vtxlabs.dev
cp extension.js metadata.json \
   ~/.local/share/gnome-shell/extensions/vtx-track@vtxlabs.dev/

# enable it (log out/in first on Wayland so the Shell reloads)
gnome-extensions enable vtx-track@vtxlabs.dev
```

Verify the daemon can reach it:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/VtxTrack \
  --method org.gnome.Shell.Extensions.VtxTrack.GetFocusedWindow
# → ('code|main.ts — vtx-track|3131',)
```

Once enabled, `vtx-track status` on GNOME/Wayland will report full
window/title tracking instead of idle-only.

## Compatibility

Supports GNOME Shell 42–47 (both the legacy ≤44 and the ESM 45+ extension
APIs). If you don't install it, vtx-track still tracks idle/active time on
GNOME/Wayland — it just can't attribute time to specific apps.
