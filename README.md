# CSIPTV - IPTV Player Application

<p align="center">
  <img src="https://raw.githubusercontent.com/cloud-saviour/csiptv/electron/src/assets/icons/favicon.256x256.png" alt="CSIPTV icon" title="Free IPTV player application" />
</p>
<p align="center">
  <a href="https://github.com/cloud-saviour/csiptv/releases"><img src="https://img.shields.io/github/release/4gray/csiptv.svg?style=for-the-badge&logo=github" alt="Release"></a>
  <a href="https://github.com/cloud-saviour/csiptv/releases"><img src="https://img.shields.io/github/v/release/4gray/csiptv?include_prereleases&label=pre-release&logo=github&style=for-the-badge" /></a>
 <img alt="GitHub Workflow Status" src="https://img.shields.io/github/actions/workflow/status/4gray/csiptv/build-and-test.yaml?style=for-the-badge&logo=github"> <a href="https://github.com/cloud-saviour/csiptv/releases"><img src="https://img.shields.io/github/downloads/4gray/csiptv/total?style=for-the-badge&logo=github" alt="Releases"></a> <a href="https://codecov.io/gh/cloud-saviour/csiptv"><img alt="Codecov" src="https://img.shields.io/codecov/c/github/4gray/csiptv?style=for-the-badge"></a> <a href="https://t.me/csiptv"><img src="https://img.shields.io/badge/telegram-csiptv-blue?logo=telegram&style=for-the-badge" alt="Telegram"></a> <a href="https://bsky.app/profile/csiptv.bsky.social"><img src="https://img.shields.io/badge/bluesky-csiptv-darkblue?logo=bluesky&style=for-the-badge" alt="Bluesky"></a>
</p>

<a href="https://t.me/csiptv">Telegram channel for discussions</a>

**CSIPTV** is a video player application that provides support for IPTV playlist playback (m3u, m3u8). The application allows users to import playlists using remote URLs or by uploading files from the local file system. Additionally, it supports EPG information in XMLTV format which can be provided via URL.

The application is a cross-platform, open-source project built with ~~Electron~~ Tauri and Angular.

⚠️ Note: CSIPTV does not provide any playlists or other digital content. The channels and pictures in the screenshots are for demonstration purposes only.

![CSIPTV: Channels list, player and epg list](./iptv-dark-theme.png)

## Features

-   M3u and M3u8 playlist support 📺
-   Xtream Code (XC) and Stalker portal (STB) support
-   External player support - MPV, VLC
-   Add playlists from the file system or remote URLs 📂
-   Automatic playlist updates on application startup
-   Channel search functionality 🔍
-   EPG support (TV Guide) with detailed information
-   TV archive/catchup/timeshift functionality
-   Group-based channel list
-   Favorite channels management
-   Global favorites aggregated from all playlists
-   HTML video player with HLS.js support or Video.js-based player
-   Internationalization with support for 16 languages:
    * Arabic
    * Moroccan arabic
    * English
    * Russian
    * German
    * Korean
    * Spanish
    * Chinese
    * Traditional chinese
    * French
    * Italian
    * Turkish
    * Japanese
    * Dutch
    * Belarusian
    * Polish  
-   Custom "User Agent" header configuration for playlists
-   Light and Dark themes
-   Docker version available for self-hosting

## Screenshots:

|                 Welcome screen: Playlists overview                 | Main player interface with channels sidebar and video player  |
| :----------------------------------------------------------------: | :-----------------------------------------------------------: |
|       ![Welcome screen: Playlists overview](./playlists.png)       |   ![Sidebar with channel and video player](./iptv-main.png)   |
|            Welcome screen: Add playlist via file upload            |             Welcome screen: Add playlist via URL              |
| ![Welcome screen: Add playlist via file upload](./iptv-upload.png) | ![Welcome screen: Add playlist via URL](./upload-via-url.png) |
|              EPG Sidebar: TV guide on the right side               |                 General application settings                  |
|         ![EPG: TV guide on the right side](./iptv-epg.png)         |         ![General app settings](./iptv-settings.png)          |
|                         Playlist settings                          |
|         ![Playlist settings](./iptv-playlist-settings.png)         |                                                               |

_Note: First version of the application which was developed as a PWA is available in an extra git branch._

## Download

Download the latest version of the application for macOS, Windows, and Linux from the [release page](https://github.com/cloud-saviour/csiptv/releases).

Alternatively, you can install the application using one of the following package managers:

### Homebrew

```shell
$ brew install csiptv
```

### Snap

```shell
$ sudo snap install csiptv
```

### Arch

Also available as an Arch PKG, [csiptv-bin](https://aur.archlinux.org/packages/csiptv-bin/), in the AUR (using your favourite AUR-helper, .e.g. `yay`)

```shell
$ yay -S csiptv-bin
```

### Gentoo

You can install CSIPTV from the [gentoo-zh overlay](https://github.com/microcai/gentoo-zh)

```shell
sudo eselect repository enable gentoo-zh
sudo emerge --sync gentoo-zh
sudo emerge csiptv-bin
```

[![Get it from the Snap Store](https://snapcraft.io/static/images/badges/en/snap-store-black.svg)](https://snapcraft.io/csiptv)

<a href="https://github.com/sponsors/cloud-saviour" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-green.png" alt="Buy Me A Coffee" width="185"></a>

## How to Build and Develop

Requirements:

-   Node.js with npm
-   Rust (required for tauri)

1. Clone this repository and install project dependencies:

    ```
    $ npm install
    ```

2. Start the application:
    ```
    $ npm run tauri dev
    ```

This will open the Tauri version in a separate window, while the PWA version will be available at http://localhost:4200.

To run only the Angular app without Tauri, use:

```
$ npm run serve
```

## Disclaimer

**CSIPTV doesn't provide any playlists or other digital content.**

<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->

[![All Contributors](https://img.shields.io/badge/all_contributors-13-orange.svg?style=flat-square)](#contributors)

<!-- ALL-CONTRIBUTORS-BADGE:END -->
