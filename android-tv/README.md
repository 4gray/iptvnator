# IPTVnator — experimental Google TV / Android TV port

> **Status: unofficial, experimental, community contribution. Not maintained.**
>
> This is a native Android TV client written in Kotlin + Jetpack Compose that
> re-implements a large part of IPTVnator for the television. It was built
> almost entirely through AI-assisted "vibe coding": the code was generated and
> iterated by coding agents, verified mostly on the Google TV emulator and a
> single real TV, and **not** carefully reviewed line by line.
>
> It works for everyday use, but it is **buggy**, above all in **remote-control
> (D-pad) navigation**: focus can get lost, jump to an unexpected element or
> need an extra key press, and some screens still open the on-screen keyboard
> when they should not. It is shared as-is in case it is useful to someone as a
> **starting point** — to fork, fix, maintain or mine for ideas.

It is not affiliated with or endorsed by the IPTVnator maintainers, and it is
not an official IPTVnator build. The app name, application id
(`com.iptvnator.googletv`) and branding are placeholders; see
[`TRADEMARK.md`](../TRADEMARK.md) before publishing a build anywhere.

## What it is

- A separate Gradle project inside the IPTVnator repository. It is **not** part
  of the Nx workspace, does not share code with the Angular/Electron app and is
  not built by the repository's CI.
- A native app, not a web wrapper: playback uses Media3 (ExoPlayer), storage is
  SQLite, and the UI is Compose for TV. The desktop app's concepts, source
  formats and behaviour were used as the reference, and parity with the
  desktop app was the goal for most features.
- The interface is **Spanish only**. The desktop translation catalogue was not
  ported.

## Features

Sources
- M3U/M3U8 from a URL, a local file (Android document picker or a built-in
  fallback picker), pasted text, or "auto-detect" from a provider message.
- Xtream Codes (live, VOD, series) with cancellable streaming import of very
  large catalogues (tested with 100k+ rows) and a step-by-step progress screen.
- Stalker / Ministra portals (MAC, serial, device ids, login), including the
  session/watchdog lifecycle and short-EPG fallback.
- Per-source User-Agent / Referer / Origin, credentials stored with the Android
  Keystore, source ordering, hidden groups/categories, desktop-compatible JSON
  backup/restore.

Watching
- Live TV with groups, favourites, recents, search, channel numbers and
  CH+/CH−/numeric zapping; radio channels.
- Movies and series with detail pages (seasons, episodes, resume, watched
  state), optional TMDB enrichment (bring your own API key).
- Media3 player: HLS, DASH (incl. ClearKey), MPEG-TS, MP4; audio / subtitle /
  quality selection, external SRT/VTT/SSA subtitles, aspect modes, speed,
  automatic reconnect, episode auto-advance, persistent volume.
- XMLTV EPG (remote or local file, manual channel mapping, time offset,
  programme search), timeline/list guide, catch-up and "start over" for
  Xtream and M3U archives.
- Downloads of VOD / episodes / archive programmes with resumable transfers,
  and native live recording (HTTP, HLS incl. AES-128, clear DASH).

UI
- "Nocturno" design system (dark and light) with an amber focus ring,
  collapsible navigation rail, poster rails and cinematic detail pages. See
  `TvTheme.kt`, `TvDesign.kt`, `TvComponents.kt` and `TvDpad.kt`.

## Known problems

Expect rough edges. The main ones known at the time of submission:

- **D-pad focus.** Most screens are navigable, but focus handling is ad-hoc
  (explicit `FocusRequester`s and `focusProperties` scattered through the UI).
  Focus sometimes lands on the wrong element, is lost after a list reloads, or
  needs an extra press. This is the area that most needs a proper redesign.
- **On-screen keyboard.** The Google TV IME opens whenever a text field starts
  an input session. Only the live-channel search and the add-source dialog use
  the "focus quietly, press OK to type" pattern; other text fields may still
  pop the keyboard during navigation.
- **Architecture.** `TvApp.kt` is a ~14,000-line file holding most of the UI
  and state. It badly needs to be split into screens and view models.
- **Language.** Spanish only; strings are hard-coded, not resources.
- **Testing.** Instrumentation tests were run on the Google TV emulator and
  only manually on one physical TV (TCL, 32-bit ARM userland). Other devices,
  remotes and Android versions are untested.
- **Signing.** The release build type is signed with the local debug key so it
  can be installed over a debug build. Use your own key for any distribution.

## Building

Requirements: JDK 17+ (21 works), Android SDK with API 36. Point
`local.properties` at your SDK (`sdk.dir=...`) or set `ANDROID_HOME`.

```bash
cd android-tv
./gradlew assembleRelease   # app/build/outputs/apk/release/app-release.apk
./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
```

**Use the release build on a real TV.** It is R8-minified (about 4 MB instead
of 24 MB), non-debuggable and ships the Compose/Media3 baseline profiles;
a debug build of Compose is several times slower and stutters even on fast
TVs. There is no ABI-specific build — the app has no native code of its own,
so the same APK runs on 32-bit ARMv7 TVs.

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
# optional: compile ahead-of-time right away instead of waiting for dexopt
adb shell cmd package compile -m speed -f com.iptvnator.googletv
```

## Tests

```bash
./gradlew testDebugUnitTest lintDebug          # ~240 JVM unit tests + lint
./gradlew assembleDebug assembleDebugAndroidTest
```

About 150 instrumentation tests (UI Automator + Compose) cover D-pad flows,
imports through the visible forms, SQLite migrations, playback, downloads and
recording. They start local HTTP fixtures themselves (see `test-fixtures/`).
Run them against one device explicitly; `connectedDebugAndroidTest` runs on
every connected device, including a real TV:

```bash
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5554 shell am instrument -w \
  com.iptvnator.googletv.test/androidx.test.runner.AndroidJUnitRunner
```

## Code map

```
app/src/main/java/com/iptvnator/googletv/
├── TvApp.kt                 # most screens, navigation and app state (to be split)
├── TvTheme.kt / TvDesign.kt # Nocturno tokens, typography, shared visual pieces
├── TvComponents.kt          # TV-sized Material wrappers (buttons, dialogs, fields)
├── TvDpad.kt                # focus ring and D-pad click handling
├── TvImportProgress.kt      # add-source progress screen
├── TvPosterRail.kt, TvVodDetailScreen.kt, TvSeriesDetailScreen.kt, TvDetailLayout.kt
├── playlist/                # M3U parser, SQLite store + migrations, repository, backup
├── xtream/, stalker/        # provider API clients
├── epg/                     # XMLTV parser, programme selection and search
├── playback/                # Media3 controller and player screen
├── download/, recording/    # resumable downloads and live recording
└── tmdb/, net/
```

`CHANGELOG.md` holds the (Spanish) history of the port's changes.

## Licence

The IPTVnator desktop application is MIT-licensed (see
[`LICENSE.md`](../LICENSE.md)); that notice is kept in [`NOTICE`](NOTICE).

The code in this `android-tv/` directory is licensed under the
**[GNU General Public License v3.0](LICENSE)** (GPL-3.0-or-later). Anyone may
use, study, modify and redistribute it — including publishing a build on an
app store — provided that every distributed version, modified or not, is also
released under the GPL with its complete source code available.
