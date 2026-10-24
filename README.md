# IPTVnator — mkaand Community Fork

> [!IMPORTANT]
> **Independent, unofficial fork** of [4gray/iptvnator](https://github.com/4gray/iptvnator), maintained at [mkaand/iptvnator](https://github.com/mkaand/iptvnator). This project is **not affiliated with or endorsed by the upstream maintainers**. It does not supply IPTV subscriptions, streams, channels, or copyrighted content. All original upstream credit and licensing remain in place.

**Current fork version: [v0.25.0-epgpriority.6](https://github.com/mkaand/iptvnator/releases/tag/v0.25.0-epgpriority.6)** (Windows x64, unsigned community preview). The M3U EPG identity-collision fix was confirmed working for BEINSPORTS 1 HD with the user's external XMLTV guide. Code is maintained on the default `master` branch; no additional development branch is required to install or use it.

This fork focuses on two practical desktop IPTV workflows: automatically organizing large mixed M3U playlists and matching an externally managed XMLTV guide to M3U/Xtream channels **without editing either source**. Upstream IPTVnator remains the foundation, and its standard playback, search, favorites, and provider integrations are retained.

## What this fork changes

| Area | Upstream IPTVnator | This fork |
| --- | --- | --- |
| M3U browsing | Traditional all-channels and group browsing | **Live TV / Movies / Series / Unclassified**, with counts per section and the original **Browse All Content** view |
| M3U content detection | Existing VOD/episode playback heuristics | A conservative, single-pass classification index combining groups, names, episode markers, paths, and VOD hints |
| M3U navigation | General channel browsing | Category-specific **All / Groups / Favorites**, while preserving source-level channel identity and preferences |
| XMLTV matching | Standard channel metadata and manual mapping | **Configurable Primary / Secondary / Third Match**: Channel Name, `tvg-name`, and `tvg-id` |
| Missing or mismatched guide IDs | May require manual mapping | Retry the next matching field after a *failed lookup*, even when an unrelated `tvg-id` exists |
| Duplicate XMLTV display names | Mapping can require manual selection | **First Exact Match:** the first matching imported XMLTV record wins, even when later records share the same channel name |
| Shared M3U `tvg-id` | HD/SD/UHD variants may carry the same provider ID | **Per-entry exact matching** keeps automatic XMLTV IDs independent, with Channel Name first by default |
| Xtream guide source | Provider EPG and externally supplied XMLTV | **Configured XMLTV First / Xtream Provider EPG First** selection plus XMLTV fallback by channel name |
| Xtream list EPG | Existing preview refresh paths | Refresh visible-channel programme previews on async category load and category switching without clicking a channel |
| M3U active timeline | Lookup at channel selection time | Re-query an active channel if its asynchronous XMLTV name/ID association changes; ignore stale older query responses |
| Windows preview builds | Official upstream release process | Fork-specific version labels, automated regression tests, and an unsigned Windows x64 preview installer attached to the fork's release |

### 📺 M3U content organization

Large playlists containing live channels, movies, and series can remain **one regularly updated M3U source**. IPTVnator classifies entries in memory; it does **not** rewrite M3U files, replace playlist URLs, create a new server, or replicate every stream into separate playlists.

- **Live TV:** established live-channel interface, groups, favorites, and EPG.
- **Movies:** selectable poster cards with title search, group filtering and pagination, retaining the original channel list on the left; TMDB poster fallback runs only with metadata enabled.
- **Series:** recognizes episode markers and groups matching entries into series, seasons and playable episodes. Unrecognized entries remain accessible separately.
- **Unclassified:** entries without sufficient evidence. The section displays a count; nothing disappears from the original playlist.
- **Browse All Content:** unchanged access to the entire original playlist.

Classification is intentionally conservative. Names, URL extensions, and group labels can be inaccurate; **Unclassified is safer than guessing**. The feature is tested with synthetic 100,000-entry playlists, but individual provider playlist accuracy must be validated with real data. Manual classification-rule editing is still outside this feature. Poster catalogs and season browsing are implemented in the separate [catalog preview branch](https://github.com/mkaand/iptvnator/tree/feat/m3u-poster-catalog-season-browser), not in the current released v0.25.0-epgpriority.6 build.

### 📅 External XMLTV and EPG matching

In **Settings → EPG → EPG Matching Preferences**, choose three distinct fields in priority order (the interface swaps positions automatically):

1. **Primary Match**: `Channel Name` by default.
2. **Secondary Match**: `tvg-name` by default.
3. **Third Match**: `tvg-id` by default.

The next field is tried only when no usable XMLTV channel match was found. Saved **manual channel mappings retain priority**. For Xtream playlists, select **Configured XMLTV First** to prefer a configured external guide, or **Xtream Provider EPG First** to prioritize the provider's built-in EPG.

**First Exact Match for duplicate channel names.** WebGrab EPG Manager may publish a canonical stream under several linked XMLTV IDs to cover different player names. The guide can therefore contain several `<channel>` records with the *same exact display name*, for example three `BEINSPORTS 1 HD` records with distinct IDs. This fork **selects the first exact name match returned by the imported guide channel index**, rather than rejecting the match or checking which candidate is on air. It does not automatically strip or conflate `HD`, `SD`, or `UHD`: those remain separate exact names. A manual mapping overrides automatic choices.

**M3U channels sharing a provider ID.** Some playlists intentionally give `A2 HD` and `A2 UHD` the same `tvg-id="A2.tr"` and `tvg-name="A2 HD"`; some give three `BEINSPORTS 1 HD` streams and an SD variant the same `LIGTV.tr`. The visible M3U **Channel Name** takes precedence by default and resolves each entry's XMLTV ID independently in session memory. A duplicated `tvg-id` no longer cancels all of these matches. HD/SD/UHD entries are not automatically conflated, even when they broadcast identical content. An explicitly customized match order is still respected.

**Manual mapping compatibility:** Existing saved mappings stay keyed by the original M3U lookup key and override automatic matching. A manual mapping for a shared `tvg-id` still applies to all its variants (the legacy behavior). The mapping dialog uses this raw key, not a transient resolved XMLTV ID; no provider sources or settings are rewritten.

**What “first” means:** The local Electron database lists EPG channels ordered by display name and, for identical names, stable SQLite insertion order (`rowid`). On a fresh import, that generally follows the XMLTV channel order; after reimports or updates, older database row identities can persist, so **reordering an existing XML file is not guaranteed to change the first imported match**. Where exact source-file order is critical, clean up duplicate names in the EPG generator and re-import accordingly.

**Trade-off:** First Exact is a deliberate user preference, not proof that multiple entries carry identical schedules. If the first entry has stale or missing programmes, the app does **not** silently pick a different duplicate based on current airtime. Use the existing manual EPG mapping UI for exceptions. The guide and playlist remain untouched, and ordered matching still respects **Channel Name → `tvg-name` → `tvg-id`** (or the saved custom priority).


### 🔧 Scope, compatibility, and downloads

- **Windows x64 installer:** Download the unsigned NSIS setup executable from this fork's [v0.25.0-epgpriority.6 release](https://github.com/mkaand/iptvnator/releases/tag/v0.25.0-epgpriority.6). The [verified GitHub Actions run](https://github.com/mkaand/iptvnator/actions/runs/40133636976) also retains a temporary build artifact. Because this is an unsigned community build, Windows SmartScreen may prompt before installation.
- **Versioning:** fork builds carry descriptive suffixes (for example, `0.25.0-epgpriority.6`) to distinguish them from upstream releases.
- **Updates:** an official upstream update can replace fork-only features. Do not install an upstream update over this preview build without checking whether the relevant changes have been integrated.
- **Privacy:** your EPG/playlist URL, database, credentials, and WebGrab EPG Manager do not need to be modified to use these features. Avoid posting private playlist URLs or Xtream credentials in bug reports.
- **Platform coverage:** EPG matching through the native XMLTV database is desktop-oriented; browser/PWA builds may lack the required Electron bridge operations.
- **Windows acceptance:** BEINSPORTS 1 HD EPG and its populated timeline were confirmed on a real Windows installation using an external XMLTV guide. Automated CI covers the A2 HD/UHD and BEINSPORTS shared-ID scenarios. Additional live-provider regressions and saved manual mapping cases should still be checked before considering the fork broadly stable.
- **Quality status:** automated tests cover the matching rules, duplicates, large-library classification, M3U/Xtream regressions, settings, and Windows packaging. Real-provider reception and guide content still require manual acceptance testing.

**Development:** All fork improvements are consolidated in the [default master branch](https://github.com/mkaand/iptvnator/tree/master). The [integration pull request](https://github.com/mkaand/iptvnator/pull/1) and commit history retain attribution and implementation details. An archived tag preserves the earlier experimental collision-fix branch.

**Upstream references:** [official IPTVnator](https://github.com/4gray/iptvnator) · [original EPG matching report, issue #1992](https://github.com/4gray/iptvnator/issues/1992). If you discover a bug in fork-only code, please use [issues in this fork](https://github.com/mkaand/iptvnator/issues) rather than attributing it to upstream.

---

## Original IPTVnator project information

The following documentation, screenshots, links, and upstream release/CI badges are inherited from the original project. They describe **upstream IPTVnator**, not the fork's own release status. Please credit and support the original authors.


<p align="center">
  <img src="https://raw.githubusercontent.com/4gray/iptvnator/electron/src/assets/icons/favicon.256x256.png" alt="IPTVnator icon" title="Free IPTV player application" />
</p>
<p align="center">
  <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/release/4gray/iptvnator.svg?style=for-the-badge&logo=github" alt="Release"></a>
  <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/v/release/4gray/iptvnator?include_prereleases&label=pre-release&logo=github&style=for-the-badge" /></a>
 <a href="https://github.com/4gray/iptvnator/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/4gray/iptvnator/ci.yml?branch=master&style=for-the-badge&logo=github&label=CI"></a> <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/downloads/4gray/iptvnator/total?style=for-the-badge&logo=github" alt="Releases"></a> <a href="https://app.codecov.io/gh/4gray/iptvnator"><img alt="Codecov" src="https://img.shields.io/codecov/c/github/4gray/iptvnator?branch=master&style=for-the-badge&logo=codecov&logoColor=white"></a> <a href="https://t.me/iptvnator"><img src="https://img.shields.io/badge/telegram-iptvnator-blue?logo=telegram&style=for-the-badge" alt="Telegram"></a> <a href="https://bsky.app/profile/iptvnator.bsky.social"><img src="https://img.shields.io/badge/bluesky-iptvnator-darkblue?logo=bluesky&style=for-the-badge" alt="Bluesky"></a>
</p>

🌐 **[Website](https://4gray.github.io/iptvnator/)** | <a href="https://t.me/iptvnator">Telegram channel for discussions</a> | <a href="https://ko-fi.com/4gray" target="_blank">Buy me a coffee</a> | <a href="https://github.com/sponsors/4gray">GitHub Sponsors</a>

**IPTVnator** is a video player application that provides support for IPTV playlist playback (m3u, m3u8). The application allows users to import playlists using remote URLs or by uploading files from the local file system. Additionally, it supports EPG information in XMLTV format which can be provided via URL.

The application is a cross-platform, open-source project built with Electron and Angular.

⚠️ Note: IPTVnator does not provide any playlists or other digital content. The channels and pictures in the screenshots are for demonstration purposes only.

> [!IMPORTANT]
> **Official sources only.** IPTVnator is a free, open-source **player** — it never sells IPTV subscriptions, channels, or playlists. Websites offering "IPTVnator subscriptions/channels/premium/activated" builds are **not affiliated** with this project. Get the app only from the [official website](https://4gray.github.io/iptvnator/) or [GitHub Releases](https://github.com/4gray/iptvnator/releases). See [Beware of unofficial IPTVnator websites and IPTV services](https://4gray.github.io/iptvnator/blog/beware-unofficial-iptvnator-websites/) for details.

![IPTVnator: Channels list, player and epg list](./apps/website/public/screenshots/screenshot-player.webp)

## Features

**Playlists & sources**

- M3U / M3U8 playlists from local files or remote URLs 📂, with automatic updates on startup
- Xtream Codes (XC) and Stalker / Ministra (STB) portal support
- Custom "User-Agent" header per playlist

**Playback**

- Built-in HTML5 player (HLS.js or Video.js) with a resizable, resumable inline view
- Optional unified IPTVnator controls for HTML5, Video.js, and ArtPlayer, enabled in **Settings → Playback** _(experimental)_
- External players — MPV, VLC, and IINA on macOS (`mpv.app` / `VLC.app` bundle paths supported) _(desktop)_
- Embedded MPV — native mpv rendered inside the app window on macOS, Windows & Linux 🖥️ _(experimental · desktop)_
- Dedicated radio player for `radio="true"` streams 📻

**Live TV & EPG**

- EPG / XMLTV TV guide with a live timeline ribbon and multi-channel grid _(desktop)_
- TV archive / catch-up / timeshift _(desktop)_
- Group-based channel list, channel-number selection, and search 🔍

**Movies & series (VOD)**

- Redesigned two-state detail pages (browse ↔ watch) with season tabs and resume positions
- Download manager for offline movies & episodes ⬇️ _(desktop)_
- "Recently added" feeds and category grids with sorting & pagination

**Discovery & metadata**

- Global search across live TV, movies, and series _(desktop)_
- TMDB enrichment (opt-in, requires your own TMDB API key) — plots, cast & crew, trailers, ratings, artwork, a "Similar" rail, clickable actor pages, and a trending dashboard rail _(trending rail: desktop)_
- Dashboard with recently watched & continue-watching

**Organization**

- Per-playlist and global favorites, aggregated across all playlists ⭐
- Recently viewed / watch history
- Command palette (`Ctrl/Cmd+K`) that also finds and opens individual settings
- Settings search from the header search box on the Settings page

**Platform**

- Cross-platform desktop (Electron) and installable PWA
- Desktop auto-updater and mobile remote control _(desktop)_
- Docker self-hosting for the PWA + web backend
- 20 languages ([translation files](apps/web/src/assets/i18n/)), light & dark themes, and keyboard shortcuts

## Keyboard shortcuts

Press `?` or `Shift+/` in the workspace to open the in-app shortcuts list.

| Area              | Shortcut                    | Action                                                     |
| ----------------- | --------------------------- | ---------------------------------------------------------- |
| Global            | `Ctrl/Cmd+K`                | Open command palette                                       |
| Global            | `Ctrl/Cmd+F`                | Open global search (desktop); on Settings, search settings |
| Global            | `Ctrl/Cmd+R`                | Open recently viewed in the desktop app                    |
| Global            | `Enter` in workspace search | Submit the search; on Settings, open the best match        |
| Global            | `F11`                       | Toggle app window fullscreen in the desktop app            |
| Navigation        | `Alt+←` / `Cmd+[` (macOS)   | Go back, like the top bar's Back and the mouse Back button |
| Navigation        | `Ctrl/Cmd+B`                | Toggle the live sidebar                                    |
| Navigation        | `0-9`                       | Select an M3U channel by number                            |
| Playback          | `Space` / `K`               | Play or pause playback                                     |
| Playback          | `F`                         | Toggle player fullscreen                                   |
| Playback          | `ArrowLeft` / `ArrowRight`  | Seek VOD playback by 5 seconds                             |
| Playback          | `ArrowUp` / `ArrowDown`     | Adjust volume by 5%                                        |
| Playback          | `M`                         | Mute audio                                                 |
| Dialogs and lists | `ArrowUp` / `ArrowDown`     | Move command palette selection                             |
| Dialogs and lists | `Enter`                     | Run the selected command or open a focused item            |
| Dialogs and lists | `Escape`                    | Close dialogs and dismiss overlays                         |

The desktop app can also open at its last size, maximized, or fullscreen on
every launch (Settings → General → "Window on startup"), and `iptvnator
--fullscreen` forces a single fullscreen launch for TV or HTPC autostart
scripts without changing that setting.

## Screenshots:

|                                     Dashboard with recently watched content                                     |                               Live channels with inline player and EPG                                |
| :-------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------: |
|    ![Dashboard with recently watched content](./apps/website/public/screenshots/dashboard-with-content.webp)    | ![Live channels with inline player and EPG](./apps/website/public/screenshots/screenshot-player.webp) |
|                                Add playlist dialog for M3U, Xtream, and Stalker                                 |                                      Live category channel list                                       |
|    ![Add playlist dialog for M3U, Xtream, and Stalker](./apps/website/public/screenshots/add-playlist.webp)     |          ![Live category channel list](./apps/website/public/screenshots/channels-view.webp)          |
|                                Global search across live TV, movies, and series                                 |                                    Manage visible live categories                                     |
|    ![Global search across live TV, movies, and series](./apps/website/public/screenshots/global-search.webp)    |      ![Manage visible live categories](./apps/website/public/screenshots/manage-categories.webp)      |
|                                 Movie category grid with sorting and pagination                                 |                                   Recently added movies and series                                    |
| ![Movie category grid with sorting and pagination](./apps/website/public/screenshots/xtream-category-view.webp) |   ![Recently added movies and series](./apps/website/public/screenshots/xtream-recently-added.webp)   |
|                                 VOD details with playback and download actions                                  |                                           Download manager                                            |
|      ![VOD details with playback and download actions](./apps/website/public/screenshots/vod-details.webp)      |             ![Download manager](./apps/website/public/screenshots/download-manager.webp)              |
|                                             Multi-channel EPG grid                                              |                                      External MPV player support                                      |
|                ![Multi-channel EPG grid](./apps/website/public/screenshots/multi-epg-view.webp)                 |  ![External MPV player support](./apps/website/public/screenshots/external-player-support-mpv.webp)   |
|                                   Radio playback with dedicated audio player                                    |                                              Light theme                                              |
|       ![Radio playback with dedicated audio player](./apps/website/public/screenshots/radio-feature.webp)       |                  ![Light theme](./apps/website/public/screenshots/light-theme.webp)                   |
|                                              Application settings                                               |                                                                                                       |
|                    ![Application settings](./apps/website/public/screenshots/settings.webp)                     |                                                                                                       |

_Note: First version of the application which was developed as a PWA is available in an extra git branch._

## Self-hosted PWA

The Docker setup builds the Angular PWA and the monorepo web backend into one
image. The backend handles remote M3U parsing plus Xtream and Stalker proxy
requests under `/api`, so a separate `4gray/iptvnator-backend` container is not
required for the default self-hosted flow.

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

The application is available at <http://localhost:4333>. See
[`docker/docker-compose.yml`](./docker/docker-compose.yml) for the ready-to-run
compose file and [`docker/README.md`](./docker/README.md) for environment
variables, reverse proxy notes, PWA limitations, and build details.

The image keeps playlists, favorites and watch progress on the server, so
every browser that opens it shares one library. The first browser that opens
an updated instance offers to move the playlists it already has.

The self-hosted image runs the browser PWA rather than the Electron desktop app:
EPG/XMLTV panels, Embedded MPV, managed MPV/VLC launching, the download manager,
and Electron remote-control features are not available there. If browser
playback fails, copy the stream URL and open it manually in an external player
such as MPV, VLC, or IINA.

## Download

Download the latest version of the application for macOS, Windows, and Linux from the [release page](https://github.com/4gray/iptvnator/releases).

Alternatively, you can install the application using one of the following package managers:

### Nightly builds

Every merge into `master` is published as a prerelease in
[4gray/iptvnator-nightly](https://github.com/4gray/iptvnator-nightly). The
desktop app can follow them: **Settings → About → Update channel → Nightly**
offers each new build through the built-in updater (macOS, Windows, and the
Linux AppImage). Nightly builds are untested snapshots — they may break, and
their database changes are permanent, so switching back to **Stable** keeps
the installed nightly until the next stable release is newer. Back up your
playlists first, and mention the version and commit shown in *About* when
reporting a bug from a nightly.

### Homebrew

```shell
$ brew install iptvnator
```

### Snap

```shell
$ sudo snap install iptvnator
```

### Arch

Also available as an Arch PKG, [iptvnator-bin](https://aur.archlinux.org/packages/iptvnator-bin/), in the AUR (using your favourite AUR-helper, .e.g. `yay`)

```shell
$ yay -S iptvnator-bin
```

### Gentoo

You can install IPTVnator from the [gentoo-zh overlay](https://github.com/microcai/gentoo-zh)

```shell
sudo eselect repository enable gentoo-zh
sudo emerge --sync gentoo-zh
sudo emerge iptvnator-bin
```

### Linux Embedded MPV Support

Embedded MPV on Linux is experimental and currently supports x64 desktop
sessions where IPTVnator runs under X11 or Xwayland. Native Wayland embedding
is not supported yet. Linux package launchers request X11 with
`--ozone-platform=x11`, so Wayland desktops still need Xwayland available.

The Linux backend starts a system `mpv` executable with `--wid`, so `mpv` must
be installed and available on `PATH`. CI validates the Linux native addon and
standard packages on Ubuntu 22.04, with Flatpak packaging built on Ubuntu 24.04.
Expected user targets are Ubuntu/Debian `.deb`, Arch/Manjaro `pacman`, RPM
distributions, and AppImage on x64 systems with X11/Xwayland plus `mpv`
installed. Flatpak and Snap builds remain available, but embedded MPV is not
announced as supported there yet because those sandboxed formats do not expose
the host `mpv` executable to the embedded backend by default.

[![Get it from the Snap Store](https://snapcraft.io/static/images/badges/en/snap-store-black.svg)](https://snapcraft.io/iptvnator)

<a href="https://github.com/sponsors/4gray" target="_blank"><img src="https://img.shields.io/badge/GitHub%20Sponsors-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub"></a>
<a href="https://ko-fi.com/4gray" target="_blank"><img src="https://img.shields.io/badge/Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi"></a>

## Troubleshooting

### macOS: "App is damaged and can't be opened"

Older unsigned macOS builds may require removing the quarantine flag from the downloaded application:

```bash
xattr -c /Applications/IPTVnator.app
```

Alternatively, if the app is located in a different directory:

```bash
xattr -c ~/Downloads/IPTVnator.app
```

### Linux: chrome-sandbox Issues

If you encounter the following error when launching IPTVnator:

```
The SUID sandbox helper binary was found, but is not configured correctly.
Rather than run without sandboxing I'm aborting now.
You need to make sure that chrome-sandbox is owned by root and has mode 4755.
```

**Solution 1: Fix chrome-sandbox permissions (Recommended for .deb/.rpm installations)**

Navigate to the IPTVnator installation directory and run:

```bash
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
```

**Solution 2: Launch with --no-sandbox flag**

Edit the desktop launcher file to add the `--no-sandbox` flag:

1. Find your desktop file location:
    - **Ubuntu/Debian**: `~/.local/share/applications/iptvnator.desktop`
    - **System-wide**: `/usr/share/applications/iptvnator.desktop`

2. Edit the file and modify the `Exec` line:

    ```
    Exec=iptvnator --no-sandbox %U
    ```

3. Save the file and relaunch the application from your application menu.

Alternatively, you can launch IPTVnator from the terminal with the flag:

```bash
iptvnator --no-sandbox
```

### GNU/Linux: Wayland startup failure

If IPTVnator exits on GNU/Linux with errors about failing to connect to
Wayland or initialize the Ozone platform, force X11/XWayland instead:

```bash
iptvnator --ozone-platform=x11
```

This workaround is mainly for older or problematic Linux graphics stacks. The
Snap package already includes this X11 override by default. For AppImage,
direct binaries, and other Linux package formats, pass the flag manually when
needed.

## How to Build and Develop

Requirements:

- Node.js 22.22.3 or newer within 22.x, or 24.15.0 or newer within 24.x
- pnpm 10.33.0 (via Corepack)

The repository's `.nvmrc` pins the Node.js version used by CI. With nvm,
run `nvm install` and `nvm use` from the repository root to use the same version
for local development.

1. Clone this repository and install project dependencies:

    ```
    $ nvm install
    $ nvm use
    $ corepack enable
    $ pnpm install
    ```

2. Start the application:
    ```
    $ pnpm run serve:backend
    ```

This will open the Electron app in a separate window, while the Angular dev server will run at http://localhost:4200.

The equivalent Nx command is:

```
$ nx serve electron-backend
```

To start Electron with an empty, isolated data directory instead of your normal
`~/.iptvnator` folder, set `IPTVNATOR_E2E_DATA_DIR` for that run:

```
$ rm -rf .tmp/iptvnator-empty && mkdir -p .tmp/iptvnator-empty
$ IPTVNATOR_E2E_DATA_DIR="$PWD/.tmp/iptvnator-empty" pnpm run serve:backend
```

This redirects the SQLite database, Electron user data, and local config under
the given directory. Delete that directory whenever you want a fresh empty
state.

If you need startup diagnostics for a white screen or a frozen route, you can
also turn on opt-in Electron tracing. These logs are written to the Electron
terminal output so they still help when the renderer DevTools never open:

```
$ IPTVNATOR_TRACE_STARTUP=1 pnpm run serve:backend
```

Nx equivalent:

```
$ IPTVNATOR_TRACE_STARTUP=1 nx serve electron-backend
```

Useful narrower flags:

- `IPTVNATOR_TRACE_IPC=1` logs renderer `window.electron.*` calls reaching the
  Electron bridge
- `IPTVNATOR_TRACE_DB=1` logs DB worker requests and request-scoped DB events
- `IPTVNATOR_TRACE_SQL=1` logs SQLite statements in both the main connection and
  DB worker connection
- `IPTVNATOR_TRACE_WINDOW=1` logs BrowserWindow load, navigation, and
  unresponsive events
- `IPTVNATOR_TRACE_RENDERER_CONSOLE=1` mirrors renderer console messages into
  the Electron terminal output

Security-sensitive network compatibility flags are opt-in:

- `IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS=1` permits strict EPG fetches from
  playlist metadata (`x-tvg-url`, `url-tvg`, or `tvg-url`) to resolve to
  localhost, LAN, or other private addresses. Directly configured
  Xtream/Stalker portals and private playlist servers remain supported without
  this flag. Prefer the in-app source-scoped “Allow source” action for a trusted
  EPG URL.
- `IPTVNATOR_ALLOW_INSECURE_TLS=1` disables certificate validation for remote
  playlist imports and refreshes for the whole Electron process. Prefer the
  in-app host-scoped trust action for a trusted provider with a self-signed or
  otherwise invalid certificate.

If the local Nx daemon gets into a bad state before rerunning Electron, reset it:

```
$ pnpm nx reset
```

To run only the Angular app without Electron, use:

```
$ pnpm run serve:frontend
```

To see how many bytes the built web app puts on the initial load path (the
number the CI ratchet guards), build it and run the measurement:

```
$ pnpm nx build web
$ pnpm run perf:initial-bytes
```

The contract behind that number is in
[docs/architecture/performance-journeys.md](docs/architecture/performance-journeys.md).

To benchmark the "launch to usable", "open a source" and "start playback"
journeys (fresh Electron processes on a seeded profile against the local
Xtream mock, exact renderer counters plus wall-clock), run:

```
$ pnpm run perf:journeys
```

The journeys, their counters and the summary written under
`dist/performance/journeys/` are described in
[docs/architecture/performance-journeys.md](docs/architecture/performance-journeys.md).
`pnpm run perf:compositing` measures the renderer's tile memory and composited
layers on the dashboard, the detail pages, Live TV and settings (the
"compositing budget" section of the same document).

## Disclaimer

**IPTVnator doesn't provide any playlists or other digital content.**

## Trademark

The name **"IPTVnator"** and the IPTVnator logo are unregistered trademarks of the project owner. The MIT license covers the source code only — it does **not** grant rights to the name or logo. Forks and redistributions (including app-store submissions) must use a different name and their own icon. See [TRADEMARK.md](./TRADEMARK.md) for details.

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->

[![All Contributors](https://img.shields.io/badge/all_contributors-13-orange.svg?style=flat-square)](#contributors)

<!-- ALL-CONTRIBUTORS-BADGE:END -->

## Developer and agent documentation

Start with the [task context map](docs/maintenance/agent-context-map.md) to find
the authoritative contract and validation for your area. Common agent rules are
in [AGENTS.md](AGENTS.md); Claude Code reads that same file directly (see
[Claude Code setup](docs/development/agent-workflow.md#claude-code)). Development and
documentation-maintenance conventions live in the
[agent workflow](docs/development/agent-workflow.md).
