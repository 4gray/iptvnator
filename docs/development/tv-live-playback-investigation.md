# LG Stalker Live investigation

Date: 2026-10-25. Base revision: `60029ff93`. Local diagnostic package: 0.1.13.
Device: OLED55BX9LB, firmware 04.64.00, webOS 5.6.2 / Chromium 68.

## Protocol comparison

The TV adapter and main application's `resolveItvPlaybackInternal` use the
channel's `cmd` and shared static-link rules. Temporary/live links call
`create_link` with `type=itv`, `disable_ad=0`, `download=0`; the web backend adds
`JsHttpRequest=1-xml` through the same URL builder used by Electron. Both use
the shared playback-command resolver. The deployed NAS 0.1.9 build also uses
the shared MAG identity and request URL builders. A captured successful link
equals the URL handed to native video after command-prefix normalization.

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
- Initial probes with the phone player closed still failed. Another installed
  desktop IPTVnator process was observed; whether it shares the active portal
  session needs confirmation before excluding concurrent authentication.

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
