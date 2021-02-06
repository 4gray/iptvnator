# IPTVnator - IPTV Player Application

<p align="center">
  <img src="https://raw.githubusercontent.com/4gray/iptvnator/electron/src/assets/icons/favicon.256x256.png" alt="IPTVnator icon" title="Free IPTV player application" />
</p>
<p align="center">
  <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/release/4gray/iptvnator.svg?style=round-square" alt="Release"></a> <a href="https://github.com/4gray/iptvnator/actions"><img src="https://github.com/4gray/iptvnator/workflows/Build%20and%20release/badge.svg" alt="Build and release"></a> <a href="https://github.com/4gray/iptvnator/releases"><img src="https://img.shields.io/github/downloads/4gray/iptvnator/total" alt="Releases"></a> <a href="https://codecov.io/gh/4gray/iptvnator"><img src="https://codecov.io/gh/4gray/iptvnator/branch/electron/graph/badge.svg?token=J53BMPYOFP"/></a>
</p>

**IPTVnator** is a video player application that provides support for the playback of IPTV playlists (m3u, m3u8). The application allows to import playlists by using remote URLs or per file upload from the file system. Additionally there is a support of EPG information XMLTV-based which can be provided by URL.

The application is an cross-platform and open source project based on Electron and Angular.

**Features:**

- M3u and M3u8 playlists support 📺
- Upload playlists from a file system 📂
- Upload remote playlists via URL 🔗
- Search for channels 🔍
- EPG support
- Group-based channels list
- Open playlist from the file system
- Save channels as favorites
- HTML video player with hls.js support or Video.js based player


| Welcome screen: Playlists overview                           | Main player interface with channels sidebar and video player                |
| :----------------------------------------------------------: | :-------------------------------------------------------: |
| ![Welcome screen: Playlists overview](./playlists.png)       | ![Sidebar with channel and video player](./iptv-main.png) |
| Welcome screen: Add playlist via file upload                | Welcome screen: Add playlist via URL                      |
| ![Welcome screen: Add playlist via file upload](./iptv-upload.png) | ![Welcome screen: Add playlist via URL](./upload-via-url.png)             |

*Note: First version of the application which was developed as a PWA is available in an extra git branch.*

# Download

Download the latest version of the application for macOS, Windows and Linux from the [release page](https://github.com/4gray/iptvnator/releases).

**IPTVnator** is also available as a snap package:

```
$ sudo snap install iptvnator
```

[![Get it from the Snap Store](https://snapcraft.io/static/images/badges/en/snap-store-black.svg)](https://snapcraft.io/iptvnator)
