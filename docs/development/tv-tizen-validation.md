# Samsung Tizen TV acceptance

The existing TV client now has a separate WGT packaging path. Local unit,
build and browser checks do not certify Samsung hardware. No TV is used for
this implementation; every device item below is intentionally unchecked.
See [development](tv-development.md#samsung-tizen-tv) for signing/install commands
and [architecture](../architecture/tv-application.md#samsung-tizen-package) for scope.

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
