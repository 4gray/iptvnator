# Native Matroska Inline Playback Design

## Context

IPTVnator's three embedded web players ultimately use Chromium's
`HTMLVideoElement` for native-file playback. ArtPlayer already maps `.mkv`
sources to `video/matroska`, and the HTML5 player assigns the source URL
directly to its video element. Video.js is the inconsistent path:
`WebPlayerViewComponent` currently classifies every non-HLS, non-MPEG-TS source
as `video/mp4`, so an MKV URL is advertised to Video.js with the wrong
container type.

Electron 41 embeds Chromium 146, whose native media pipeline recognizes
Matroska. Successful playback still depends on the codecs inside the container
and on platform decoder availability. The browser players must therefore try a
correctly described MKV source and retain the existing error-driven MPV/VLC
fallback rather than promising universal Matroska codec support.

## Goals

- Pass `.mkv` sources to Video.js as the registered MIME type
  `video/matroska`.
- Recognize both path extensions and explicit IPTV query metadata such as
  `?extension=mkv` or `?container=mkv`.
- Keep ArtPlayer and HTML5 on their existing native-video paths.
- Preserve the existing browser playback error classification and explicit
  MPV/VLC fallback after a real source or decode failure.
- Treat Electron as the validated runtime while leaving PWA playback as
  best-effort according to the user's browser.
- Add regression coverage and perform a real Electron playback smoke before
  publication.

## Non-Goals

- Adding a JavaScript Matroska demuxer, transcoder, or remuxing backend.
- Claiming support for every codec that Matroska can contain.
- Automatically switching the saved player or silently launching an external
  player.
- Changing Embedded MPV or external MPV/VLC playback.
- Adding a codec list to the source MIME string when the provider has not
  supplied authoritative codec metadata.

## Selected Approach

Extend the existing source-type decision in `WebPlayerViewComponent` with an
explicit MKV branch:

```text
m3u / m3u8       -> application/x-mpegURL
ts / no extension -> video/mp2t
mkv              -> video/matroska
other            -> video/mp4
```

`getPlaybackMediaExtensionFromUrl()` remains the canonical extension parser, so
signed URLs and query-declared formats use the same rule as normal `.mkv`
paths. No preflight `canPlayType()` gate is added: without the actual codec list
it can only provide a container-level guess and would duplicate the native
player's authoritative load result.

ArtPlayer's existing `video/matroska` custom type continues to call its native
source path. The HTML5 player continues to assign the URL directly and lets the
response MIME type and Chromium sniffing participate in source selection.

## Error Handling

The current diagnostics run only after a native media error. They do not reject
MKV before loading. A native `MEDIA_ERR_SRC_NOT_SUPPORTED` for an MKV source
therefore remains classified as `unsupported-container`, while decode failures
remain `media-decode-error`. Electron may continue to offer explicit MPV/VLC
fallback actions; PWA builds continue to offer retry and copy/help behavior.

This preserves useful fallback for unsupported MKV codec combinations such as
platform-dependent HEVC, AC-3/E-AC-3, DTS, or legacy MPEG-4 variants.

## Testing

### Automated regression coverage

- Add a `WebPlayerViewComponent` test proving a `.mkv` path produces a
  Video.js source with `type: 'video/matroska'`.
- Add a second test proving query-declared MKV produces the same type.
- Retain the existing ArtPlayer test for `.mkv -> video/matroska`.
- Retain the existing native-error diagnostic test proving unsupported MKV
  still recommends the external fallback after an actual error.

### Runtime validation

Serve a small local MKV with byte-range support and
`Content-Type: video/matroska`, then verify in the Electron runtime that:

- Video.js receives `video/matroska`;
- metadata loads and playback time advances for a Chromium-supported codec
  combination;
- no playback diagnostic appears for the supported fixture;
- an unsupported fixture or synthetic native error still surfaces the existing
  fallback rather than hanging the player.

If a redistributable fixture cannot be committed without adding unnecessary
binary weight, keep the automated contract tests in-tree and document the
temporary local fixture used for the Electron smoke in the PR.

## Documentation

Update the codec/container diagnostics section of
`docs/architecture/embedded-inline-playback.md` to record that MKV is attempted
through Chromium's native Matroska path, that Video.js uses
`video/matroska`, and that codec-dependent failures still use the existing
MPV/VLC fallback.

## Rollback

The change is isolated to Video.js MIME routing. Reverting the explicit MKV
branch restores the previous `video/mp4` fallback without affecting ArtPlayer,
HTML5, Embedded MPV, or external players.
