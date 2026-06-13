# IPTVnator - IPTV Player Application

<p align="center">
  <img src="https://raw.githubusercontent.com/4gray/iptvnator/electron/src/assets/icons/favicon.256x256.png" alt="IPTVnator icon" title="Free IPTV player application" />
</p>
<p align="center">
  <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/release/4gray/iptvnator.svg?style=for-the-badge&logo=github" alt="Release"></a>
  <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/v/release/4gray/iptvnator?include_prereleases&label=pre-release&logo=github&style=for-the-badge" /></a>
 <img alt="GitHub Workflow Status" src="https://img.shields.io/github/actions/workflow/status/4gray/iptvnator/build-and-test.yaml?style=for-the-badge&logo=github"> <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/downloads/4gray/iptvnator/total?style=for-the-badge&logo=github" alt="Releases"></a> <a href="https://codecov.io/gh/4gray/iptvnator"><img alt="Codecov" src="https://img.shields.io/codecov/c/github/4gray/iptvnator?style=for-the-badge"></a> <a href="https://t.me/iptvnator"><img src="https://img.shields.io/badge/telegram-iptvnator-blue?logo=telegram&style=for-the-badge" alt="Telegram"></a> <a href="https://bsky.app/profile/iptvnator.bsky.social"><img src="https://img.shields.io/badge/bluesky-iptvnator-darkblue?logo=bluesky&style=for-the-badge" alt="Bluesky"></a>
</p>

🌐 **[Website](https://4gray.github.io/iptvnator/)** | <a href="https://t.me/iptvnator">Telegram channel for discussions</a> | <a href="https://ko-fi.com/4gray" target="_blank">Buy me a coffee</a> | <a href="https://github.com/sponsors/4gray">GitHub Sponsors</a>

**IPTVnator** is a video player application that provides support for IPTV playlist playback (m3u, m3u8). The application allows users to import playlists using remote URLs or by uploading files from the local file system. Additionally, it supports EPG information in XMLTV format which can be provided via URL.

The application is a cross-platform, open-source project built with Electron and Angular.

⚠️ Note: IPTVnator does not provide any playlists or other digital content. The channels and pictures in the screenshots are for demonstration purposes only.

![IPTVnator: Channels list, player and epg list](./apps/website/public/screenshots/screenshot-player.webp)

## Features

- M3u and M3u8 playlist support 📺
- Radio playlist support with dedicated audio player 📻
- Xtream Code (XC) and Stalker portal (STB) support
- External player support - MPV and VLC; macOS accepts `mpv.app` / `VLC.app` bundle paths. IINA can be launched via its executable path on macOS (best-effort: controls and position polling are MPV IPC only)
- Add playlists from the file system or remote URLs 📂
- Automatic playlist updates on application startup
- Channel search functionality 🔍
- EPG support (TV Guide) with detailed information
- TV archive/catchup/timeshift functionality
- Group-based channel list
- Read-only M3U channel details from channel context menus, including favorites and recently viewed
- Favorite channels management
- Global favorites aggregated from all playlists
- Recently viewed live channel removal from row actions and context menus
- HTML video player with HLS.js support or Video.js-based player
- Internationalization with support for 16 languages:
    - Arabic
    - Moroccan arabic
    - English
    - Russian
    - German
    - Korean
    - Spanish
    - Chinese
    - Traditional chinese
    - French
    - Italian
    - Turkish
    - Japanese
    - Dutch
    - Belarusian
    - Polish
- Custom "User Agent" header configuration for playlists
- Light and Dark themes
- Docker image available for self-hosting the PWA and web backend together

## Keyboard shortcuts

Press `?` or `Shift+/` in the workspace to open the in-app shortcuts list.

| Area              | Shortcut                    | Action                                                     |
| ----------------- | --------------------------- | ---------------------------------------------------------- |
| Global            | `Ctrl/Cmd+K`                | Open command palette                                       |
| Global            | `Ctrl/Cmd+F`                | Open global search in the desktop app                      |
| Global            | `Ctrl/Cmd+R`                | Open recently viewed in the desktop app                    |
| Global            | `Enter` in workspace search | Submit the current search                                  |
| Navigation        | `Ctrl/Cmd+B`                | Toggle the live sidebar                                    |
| Navigation        | `0-9`                       | Select an M3U channel by number                            |
| Playback          | `Space` / `K`               | Play or pause embedded MPV playback in the desktop app     |
| Playback          | `F`                         | Toggle embedded MPV fullscreen in the desktop app          |
| Playback          | `ArrowLeft` / `ArrowRight`  | Seek embedded MPV playback by 5 seconds in the desktop app |
| Playback          | `ArrowUp` / `ArrowDown`     | Adjust volume by 5%                                        |
| Playback          | `M`                         | Mute audio                                                 |
| Dialogs and lists | `ArrowUp` / `ArrowDown`     | Move command palette selection                             |
| Dialogs and lists | `Enter`                     | Run the selected command or open a focused item            |
| Dialogs and lists | `Escape`                    | Close dialogs and dismiss overlays                         |

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

The self-hosted image runs the browser PWA rather than the Electron desktop app:
EPG/XMLTV panels, Embedded MPV, managed MPV/VLC launching, the download manager,
and Electron remote-control features are not available there. If browser
playback fails, copy the stream URL and open it manually in an external player
such as MPV, VLC, or IINA.

## Download

Download the latest version of the application for macOS, Windows, and Linux from the [release page](https://github.com/4gray/iptvnator/releases).

Alternatively, you can install the application using one of the following package managers:

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

<a href="https://github.com/sponsors/4gray" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-green.png" alt="Buy Me A Coffee" width="185"></a>

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

- Node.js with pnpm (via Corepack)

1. Clone this repository and install project dependencies:

    ```
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

If you need to debug renderer freezes or GPU/compositor issues in Electron, you
can disable hardware acceleration for a run:

```
$ IPTVNATOR_DISABLE_HARDWARE_ACCELERATION=1 pnpm run serve:backend
```

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
  playlist metadata (`url-tvg`) to resolve to localhost, LAN, or other private
  addresses. Directly configured Xtream/Stalker portals and private playlist
  servers remain supported without this flag. Prefer the in-app source-scoped
  “Allow source” action for a trusted EPG URL.
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

## Disclaimer

**IPTVnator doesn't provide any playlists or other digital content.**

## Trademark

The name **"IPTVnator"** and the IPTVnator logo are unregistered trademarks of the project owner. The MIT license covers the source code only — it does **not** grant rights to the name or logo. Forks and redistributions (including app-store submissions) must use a different name and their own icon. See [TRADEMARK.md](./TRADEMARK.md) for details.

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->

[![All Contributors](https://img.shields.io/badge/all_contributors-13-orange.svg?style=flat-square)](#contributors)

<!-- ALL-CONTRIBUTORS-BADGE:END -->
