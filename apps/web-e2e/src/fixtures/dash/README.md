# Offline DASH ClearKey fixtures

Deterministic ~4 s DASH assets used by the DASH/ClearKey e2e suites
(`apps/web-e2e/src/dash-clearkey.e2e.ts` and the Electron equivalent):

| File                 | Content                                              |
| -------------------- | ---------------------------------------------------- |
| `clearkey-video.mp4` | VP9 video, CENC (`cenc` AES-CTR, subsample) encrypted |
| `clearkey-audio.mp4` | Opus audio, CENC encrypted                           |
| `clearkey.mpd`       | Static on-demand MPD for the encrypted pair          |
| `clear-video.mp4`    | VP9 video, unencrypted (clear-DASH regression case)  |
| `clear-audio.mp4`    | Opus audio, unencrypted                              |
| `clear.mpd`          | Static on-demand MPD for the clear pair              |

Fixed ClearKey test credentials (obviously synthetic, safe to commit):

- KID: `00112233445566778899aabbccddeeff`
- KEY: `ffeeddccbbaa99887766554433221100`

They correspond to the `#KODIPROP:inputstream.adaptive.license_key=KID:KEY`
value used by the e2e playlists.

**Why VP9+Opus:** Playwright's bundled Chromium ships without proprietary
codecs (no H.264/AAC), while royalty-free VP9/Opus decode both there and in
Electron — one fixture serves both suites.

**Why Shaka Packager for encryption:** ffmpeg's mp4 muxer only writes `senc`
sample-encryption metadata — Chromium's demuxer requires `saiz`/`saio` and
fails with `CHUNK_DEMUXER_ERROR_APPEND_FAILED: Sample encryption info is not
available`. ffmpeg also cannot produce the subsample encryption that the VP9
CENC binding mandates (a fully-encrypted VP9 track ends in
`MEDIA_ERR_DECODE`). Shaka Packager produces spec-compliant output for both.

## Regeneration

```bash
node apps/web-e2e/src/fixtures/dash/generate-fixture.mjs
```

Requires `ffmpeg` (tested with 7.x) with `libvpx-vp9` and `libopus`. Shaka
Packager is resolved in this order: the `SHAKA_PACKAGER` env var (path to a
`packager` binary), an installed `shaka-packager` npm package, otherwise the
script fetches the official npm package (prebuilt per-platform binaries) once
into a temp directory via `npm pack`.

The script synthesizes the content with ffmpeg (`testsrc2` + `sine`, clear
master), then packages both variants with Shaka Packager, which also writes
the MPDs. Byte-exact output across tool versions is not guaranteed; the
committed files are the source of truth.
