# Samsung Tizen TV acceptance

The shared TV client has a separate WGT packaging path. Unit, build and browser
checks complement testing on hardware. Use the checklist for each TV you test.
See [development](tv-development.md#samsung-tizen-tv) for signing/install commands
and [architecture](../architecture/tv-application.md#samsung-tizen-package) for scope.

## Community device test

The [PR #2126 device report](https://github.com/4gray/iptvnator/pull/2126#issuecomment-6703818846)
covers a Samsung Q60C (2023) running Tizen 9.0 and Chromium 120, with WGT 0.1.25
from commit `725e83e366a1894849a263c6cb4f83a167b49a76`. The contributor verified
signing and installation, cold launch, Xtream phone setup, HLS picture and audio,
remote navigation and playback controls, EPG, VOD seek and resume, and persistence
after relaunch. Remote DevTools showed the screensaver API switching off during
playback and back on after pause or stop.

MPEG-TS, M3U and Stalker sources, other remote types, a long playback session past
the TV's screensaver interval, reinstall/update, quota failure and app hide/return
still need hardware testing.

## Device checklist

Record model, firmware, Tizen/browser version, tested commit, WGT version and
SHA-256 locally. Use an owner-controlled test backend and permitted test media;
keep certificates, profiles, credentials and device addresses out of Git.

- [ ] Sign, inspect the WGT (no LG manifest), install and cold-launch from the launcher.
- [ ] About reports Samsung Tizen TV and the installed application ID; layout fits the TV.
- [ ] Add M3U, Xtream and Stalker sources through manual/phone entry; verify backend
  connectivity and the actual packaged Origin allowlist. Test source-library refresh.
- [ ] Browse Live, films and regular/embedded/lazy series; search, categories,
  detail Back, episode identity and focus restoration work without autoplay on focus.
- [ ] Arrows/OK, Back 10009, text entry, pickers, phone dialogs, Settings categories,
  guide overlays and fullscreen Back each stay within their owning navigation layer.
- [ ] Registered Play, Pause, Stop, Rewind, Fast-forward and Play/Pause work on both
  available remote types. Unsupported registration preserves other keys; no colour
  actions are assigned. Root Back exits to the launcher; long Return retains OS behavior.
- [ ] Live preview/fullscreen and channel switching work with permitted clear HLS
  (including signed/query URLs) and MPEG-TS: picture, audio and recoverable errors.
- [ ] Films/episodes pause, resume, seek and restore saved positions, including late
  duration/seekable ranges. Stop removes the old source; Back restores the opening control.
- [ ] With Auto Protection Time enabled, watch Live and VOD beyond its interval
  without remote input. Playback stays visible; pause/stop, playback error and app
  hide restore screensaver protection, and resuming playback disables it again.
- [ ] Single-channel and multi-channel EPG load, scroll and handle unavailable data.
- [ ] Sources, settings, favorites, history and positions survive exit/cold relaunch
  and reinstall/update as appropriate. Check quota failure, offline/backend recovery,
  app hide/return, and that failed resume preserves the previous saved position.

## Open device questions

Does Samsung native video accept the existing explicit HLS MIME/source path,
signed playlists and the required audio/codecs without AVPlay? Do seek readiness,
visibility pause and best-effort exit persistence behave as expected? Native video
cannot attach arbitrary provider headers; backend API success does not prove media
compatibility. No AVPlay, media relay or transcoder is added.

Maintainer decisions before distribution: confirm the neutral widget/package IDs
and signing ownership, and decide whether Samsung Store submission needs a root
exit-confirmation dialog. This developer package follows the existing LG immediate
root Back behavior; Samsung's [store Return policy](https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html)
requires confirmation for submission.
