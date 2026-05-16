# Windows VPN Launcher

This app can use the built-in generic VPN setting for supported providers. A
local launcher is still available for providers that need a custom CLI flow.
Keep the real launcher in an ignored local file and commit only the template.

Recommended local flow:

1. Copy `tools/launchers/windows-vpn-app-launcher.template.ps1` to an ignored
   local path such as `.local/Start-VPN-App.ps1`.
2. Fill the local file with the VPN executable, process name, target location,
   and app executable or shortcut.
3. Copy `tools/launchers/windows-hidden-command-launcher.template.vbs` to an
   ignored local path and point it to the local launcher.
4. Point the desktop shortcut to `wscript.exe` with the local `.vbs` path as
   its argument. Do not point shortcuts directly to `.cmd` or `.ps1` files,
   because Windows can create a visible console before the app splash appears.

For Proton VPN, prefer the built-in app integration when possible. In that
flow the desktop shortcut should launch IPTVnator immediately; the Electron
startup splash is shown first, then Proton is prepared from the background
integration before the main app window is shown.

When launching a local repository build, run
`tools/launchers/ensure-local-dist-fresh.mjs` before Electron. It prevents a
blank window caused by opening an old `dist` build after source files changed.

The template writes an `IPTVNATOR_VPN_STATUS_FILE` value before it starts the
app. The desktop backend reads that status file at shutdown and only restores
the VPN state when the launcher reports that it changed the VPN for this app
session.

The template intentionally uses placeholders. Do not commit credentials,
private server URLs, account names, local absolute paths, or provider-specific
tokens.

The launcher should:

- check whether the VPN process is already running;
- connect only when the target location is not already active;
- start the VPN hidden in the background when it has to be started by the app;
- open IPTVnator after the VPN step;
- restore the original VPN state when all app and background metadata work has
  completed, if the launcher changed that state.
