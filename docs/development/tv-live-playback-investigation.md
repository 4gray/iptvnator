# LG Stalker Live investigation

Date: 2026-10-25. Base revision: `60029ff93`. Initial diagnostic package: 0.1.13;
watchdog continuation: 0.1.14.
Device: OLED55BX9LB, firmware 04.64.00, webOS 5.6.2 / Chromium 68.

## Protocol comparison

The TV adapter and main application's `resolveItvPlaybackInternal` use the
channel's `cmd` and shared static-link rules. Temporary/live links call
`create_link` with `type=itv`, `disable_ad=0`, `download=0`; the web backend adds
`JsHttpRequest=1-xml` through the same URL builder used by Electron. Both use
the shared playback-command resolver. The deployed NAS 0.1.9 build also uses
the shared MAG identity and request URL builders. A captured successful link
equals the URL handed to native video after command-prefix normalization.

Repeated observed `create_link` responses contain different temporary URLs and
are not marked as disk-cache responses. Favorites retain the original item/cmd;
both playback resolution and Retry call the provider again. Selecting an already
selected live item opens fullscreen instead of minting a link; the error UI's
Retry explicitly resolves a new one. No signed playback URL is persisted as the
channel command. Cached catalog data is therefore not the demonstrated cause.

Electron can attach a stream header profile; native HTML video cannot attach
arbitrary portal credentials. Foreign-host streams use a credential-free
profile in Electron, so forwarding the portal MAC cookie/Bearer to the CDN is
not the solution. Matching that profile in a probe does not consistently
resolve the observed rejection.

## Real-device evidence and limits

- Red Bull TV HD plays natively with advancing time and `readyState=4`. Its
  HTTPS URL uses another media host and lacks the failing links' `token`
  parameter. Its success does not establish signed-link access.
- Failing links return HTTP 403, sometimes followed by native error 4. Fresh
  links can instead return valid HLS master and variant playlists with 200.
  A delayed 403 probe therefore does not establish a codec failure or prove
  that a freshly minted link was already unusable.
- The TV decodes both First Channel variants and Setanta Sports 1 when given
  an accessible variant/master. HD video reports 1920×1080 and advancing time.
  A temporary LAN server served only the captured master; segments still came
  directly from the provider. This is diagnostic evidence, not a shipped relay.
- Explicit HLS MIME type and webOS `mediaTransportType=HLS` do not consistently
  resolve clean, unprimed launches. Earlier successful MIME experiments were
  followed by repeat failures; this is not a confirmed complete fix.
- After the user confirmed quitting desktop IPTVnator with Cmd-Q (the phone
  player was already closed), the TV app was fully closed and launched again
  through webOS CLI. First Channel and Setanta Sports 1 still failed before
  metadata (`readyState=0`, time 0, source-error alert). A successful uncached
  `create_link` returned a command. Setanta's Retry produced a different media
  URL but still failed. No external media probe or source override was used in
  this run. Red Bull TV HD then played at 1280×720, `readyState=4`, without an
  error/alert. Restarting alone therefore did not resolve this reproduction.
- During the preceding full restart, an unsuccessful link request triggered
  handshake/profile and a repeated `create_link`. Startup can reuse a stored
  valid portal token; restarting does not unconditionally discard it. Portal
  authorization repair and a fresh media URL do not by themselves establish
  that the native media request will succeed. Concurrent-client interference
  remains unproven and is not an established root cause.

No credentials, MAC values, portal addresses, signed URLs or manifests are
recorded here or in diagnostic files. Temporary media overrides and the
master-only server are removed after the experiment. No NAS service is changed.

## Local package checks

0.1.13 explicitly types `.m3u8` sources, clears child sources on stop/switch,
and reports source-level errors with retry. It does not add a media relay,
change Stalker request parameters, or claim to solve provider authorization.

74 unit tests pass. The new lifecycle regression fails before the change and
passes afterwards. All 88 existing browser E2E scenarios pass with source
selection assertions updated; an additional source-error/retry E2E passes
separately. Browser native playback uses a WebM fixture and does not validate
LG HLS behavior. Affected type/lint checks, production/ES2018 verification,
IPK packaging, release-note and agent-guidance checks pass. Electron/backend
tests are not rerun because their runtime code is unchanged.

The IPK installs and launches, and installed metadata reports 0.1.13.
SHA-256: `1484eaf27968b05b59e720ebd0e28838c604142c890dfdb339fe09267194417c`.
Red Bull TV HD also plays in the installed build with `readyState=4`, advancing
time and no error/alert. The TV is left on that channel. Signed-link playback
acceptance remains open. No push, PR or CI is run.


## Stalkinator watchdog comparison and TV 0.1.14

Continuation base: `9841741d3` (which follows `ee02b2f5c`). The uncommitted
full-restart findings above were retained. Stalkinator's recorded solution is
`f854c63a` (merged by `f918a205`), documented in its
`docs/STALKER_PROTOCOL.md` playback section and `docs/CURRENT_STATE.md`:
Live may receive a signed URL but fail at the media host until the authenticated
portal session sends `type=watchdog&action=get_events&event_active_id=0&cur_play_type=0&init=1`.
Stalkinator awaits this before Live resolution, then sends `init=0` on subsequent
Live starts and every 25 seconds. The main IPTVnator's
`StalkerWatchdogController.sendPing` uses the same parameter set with immediate
initialization on activation and its profile-based periodic cadence.

The TV implementation instead scheduled only delayed `type=stb&action=get_events`
after authentication, without `init`, `event_active_id`, or `cur_play_type`.
An original-build LG control reproduced First Channel at readyState 0/time 0
with a source alert. One authenticated watchdog/init=1 request from the TV,
followed by the existing Retry (fresh create_link), produced readyState 4,
1047×576 and advancing time (0.2 → 7.386 s). No Mac media request, rewritten
manifest, or overridden video URL was involved.

TV 0.1.14 awaits the best-effort watchdog before full-portal ITV create_link,
shares concurrent preparation, keeps the session alive at 25 seconds, resets
initialization after auth repair, and cancels its timer on disposal. Simple
portals and VOD/Series do not start it. Playback headers, media URLs, backend
and decoder are unchanged. A watchdog failure does not prevent create_link.

Installed-package evidence, without manual watchdog/media overrides:

- The very first First Channel start after installing 0.1.14 still failed
  before metadata despite a successful uncached watchdog/init=1 with the same
  token as create_link. Explicit Retry (watchdog/init=0 → fresh create_link)
  then played. This failure is retained, not counted as a successful cold start.
- Setanta Sports 1 played at 1920×1080, readyState 4, no alert, and advancing
  time (3.52 → 21.181 s). Red Bull TV HD remained a working 1280×720 control.
- After a full CLI close/launch, Setanta was the first requested channel and
  played without Retry: 1920×1080, readyState 4, time 6.412 s, no alert.
  First Channel then played without Retry (1047×576, time 5.377 s), followed
  by First Channel HD (1920×1080, time 5.474 s), both readyState 4/no alert.
- After another full close/launch, First Channel was the first requested
  channel and played without Retry: readyState 4, 1047×576, time 4.905 s,
  no alert.

Live catalog comparison also completed for First Channel and First Channel HD:
get_all_channels returned 395 rows; the matching get_ordered_list search rows
have identical channel IDs, original cmd, use_http_tmp_link and
use_load_balancing values. This does not support changing the TV loader for
these channels. The separate Setanta catalog comparison did not complete
because its diagnostic backend request returned no js payload; playback itself
was verified through the normal UI as above.

The missing watchdog is a confirmed implementation difference with a positive
on-device intervention and subsequent successful normal launches. It is not
proof that every first-launch rejection is eliminated: the initial 0.1.14
failure remains unexplained. No arbitrary delay or automatic media retry was
added to conceal that result. Audio was not independently verified by a human.

Local validation: all 79 TV unit tests pass. Five new unit regressions cover ordered initialization,
keepalive/disposal, unsupported watchdog/simple/VOD behavior, link auth repair,
concurrent cancellation, and keepalive auth renewal. The initial three fail
against the original implementation and pass after the change. All 90 TV
browser E2E scenarios pass, including delayed watchdog completion before
create_link/native media load. They use WebM fixture media, not real LG HLS.
TV/test/E2E typechecks and lint, production build, ES2018 verification, IPK
packaging, release notes and agent guidance validation pass. The release note
is `.changes/tv-stalker-live-watchdog.md`. Main Angular/Electron/backend tests
are not rerun because their runtime code is unchanged; native playback was
verified on the actual LG instead. No push, PR, merge, NAS change or CI run.

The installed 0.1.14 package SHA-256 is
`7a0195c44c776cee024d78977c4f65f05a65bc453ff5399dbbea6a94ea6ac5f8`.
The second cold-start First Channel run reached 50.648 s with readyState 4,
1047×576 and no alert; network observation confirmed automatic watchdog/init=0
pings after the initial init=1. The TV is left playing First Channel.
