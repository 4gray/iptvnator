# IPTVnator on a Samsung TV

IPTVnator is not in the Samsung TV store. You build it, sign it with your own
free Samsung certificate and install it on your TV in Developer Mode. Nobody
else can sign it for your TV, and no signed app is published with IPTVnator.

The experimental package targets Tizen 5.5 and newer. The
[device checklist](../../../docs/development/tv-tizen-validation.md) records
community test results and the remaining hardware checks.

## 1. Install the tools (computer)

Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
with **Samsung TV Extension** and **Samsung Certificate Extension**. Put `tizen`
(`tizen.bat` on Windows) and `sdb` on your PATH.

## 2. Turn on Developer Mode (TV)

1. Open **Apps**, then press `1 2 3 4 5` on the remote.
2. Turn **Developer mode** On and enter your computer's IP address.
3. Restart the TV.

## 3. Create your certificate (computer, once)

In Tizen Studio's **Certificate Manager**, create a **Samsung** certificate profile
for a TV, sign in with your Samsung account, and add your TV's DUID (shown after
`sdb connect <tv-ip>:26101`). This profile is yours: keep it out of Git and back it up.
See Samsung's [certificate guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).

## 4. Build and sign (computer)

```sh
corepack pnpm install --frozen-lockfile
TIZEN_SIGNING_PROFILE='<your-profile>' corepack pnpm nx run tv:package-tizen
```

On PowerShell, set `$env:TIZEN_SIGNING_PROFILE = '<your-profile>'` first. The
signed app is in `dist/tv-tizen-package`.

## 5. Install (computer → TV)

```sh
sdb connect <tv-ip>:26101
tizen install -s <tv-ip>:26101 -n "<file>.wgt" -- dist/tv-tizen-package
```

**IPTVnator TV** then appears under Apps. Repeat steps 4–5 to update; your
sources and settings stay on the TV.

## 6. Backend

The TV app reaches your providers through an IPTVnator backend on your home
network (a computer or NAS that stays on). See
[TV development](../../../docs/development/tv-development.md) and
[TV companion backend](../../../docker/tv/README.md), then enter its address in
the app's Settings.
