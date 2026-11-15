# IPTVnator for Android TV and Fire TV

The APK runs the Angular PWA from `apps/web` in an Android WebView. Its embedded
Java backend serves the PWA and provider APIs over loopback, so the installed app
runs without a separately hosted backend. The shell adds remote navigation through
`tv.js` and native integration for file selection and external playback. See the
[shell structure](README.md#structure) for the owning directories.

## Run locally in a browser

After installing workspace dependencies, run these commands from the repository root.

```sh
pnpm nx build web --configuration=pwa
WWW="$PWD/dist/apps/web" tv-shell/devserver/run-dev.sh
```

Open <http://127.0.0.1:43330>. The Node reference server serves the built PWA
and starts a synthetic provider. Use the arrow keys and Enter for navigation,
F9 for Back, F10 for Menu, and F8 for Play/Pause.

## Validate changes

- With the dev server running, run `node tv-shell/tests/tv-remote.mjs` and
  `node tv-shell/tests/tv-longlist.mjs` for Chromium remote-control coverage.
- Run `node --test tv-shell/tests/*.test.mjs` for reference server and fixture
  checks. Run `./gradlew :backend:check` from `tv-shell/android` for the Java backend.
- For WebView and native bridge changes, follow the [Android emulator checks](README.md#developing-and-testing-on-a-pc).
  For a local APK build, follow the [JDK 17 and Android SDK instructions](README.md#locally-android-studio-or-the-command-line).
