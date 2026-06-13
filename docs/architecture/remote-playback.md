# Remote Playback And Casting

This document records the remote playback contract for IPTVnator's shared
players.

## Scope

The cast control is always present on:

- the shared video viewport used by Video.js, HTML5, ArtPlayer, and embedded MPV
- the dedicated radio/audio player
- the external MPV/VLC playback dock

The feature hands a media URL to a receiver. It does not mirror the IPTVnator
window or the operating-system desktop.

## Runtime Matrix

| Protocol        | Runtime                                                     | Implementation                                                 |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| AirPlay         | Safari/WebKit PWA when the media element exposes the picker | Native `webkitShowPlaybackTargetPicker()`                      |
| Google Cast     | Secure PWA                                                  | Official Google Cast Web Sender SDK and Default Media Receiver |
| Remote Playback | Browser exposing the Remote Playback API                    | Native media-element `remote.prompt()`                         |
| DLNA/UPnP       | Electron                                                    | Main-process SSDP discovery and AVTransport SOAP actions       |

Unsupported choices remain visible but disabled so the control has a stable
location across players and runtimes.

## Receiver-Fetchable Media

Remote receivers fetch the stream themselves. Casting is disabled when the
playback payload depends on:

- `blob:`, `data:`, or `file:` URLs
- `localhost`, IPv4 loopback, or IPv6 loopback URLs
- embedded URL credentials
- provider request headers, user-agent, referer, or origin overrides

The external-player session snapshot exposes only
`requiresRequestHeaders: true`; it never copies provider header values or
authorization credentials back to the renderer.

The Default Media Receiver is intended for direct, receiver-compatible media.
Streams needing cookies, DRM, a custom receiver, provider headers, or a
sender-only local URL require a different architecture and must not silently
fall back to an unsafe request path.

## Google Cast

`CastService` loads the official sender SDK from:

`https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1`

The web CSP permits only that origin in addition to self-hosted scripts. SDK
load failures and timeouts clear the cached initialization promise so a later
user action can retry.

Google Cast uses the Default Media Receiver application ID and sends a typed
media load request with title, thumbnail, live/buffered stream type, and a MIME
type inferred from the URL extension.

## DLNA/UPnP

Electron owns DLNA networking:

1. Send an SSDP `M-SEARCH` for MediaRenderer devices over UDP multicast.
2. Accept descriptions only from private IPv4 responders.
3. Pin HTTP(S) description and control requests to the SSDP responder address.
4. Parse renderer XML with `saxes`.
5. Cache an opaque renderer ID for five minutes.
6. Send `SetAVTransportURI`, then `Play`, to the cached AVTransport endpoint.

The renderer never supplies an arbitrary request URL through IPC. Playback IPC
accepts only a cached device ID and a typed `ResolvedPortalPlayback` payload.
Pinned requests retain the advertised hostname for HTTP `Host`, TLS SNI, and
certificate validation while connecting to the validated SSDP source address.
Redirects are not followed, responses are size-limited, and requests time out.

## Ownership

- UI control and browser protocols:
  `libs/ui/playback/src/lib/casting/`
- shared renderer contract:
  `libs/shared/interfaces/src/lib/casting.interface.ts`
- preload contract:
  `libs/shared/interfaces/src/lib/electron-api.interface.ts`
- Electron IPC:
  `apps/electron-backend/src/app/events/casting.events.ts`
- SSDP, XML, HTTP pinning, and SOAP:
  `apps/electron-backend/src/app/services/dlna-protocol.ts`
- renderer discovery and playback:
  `apps/electron-backend/src/app/services/dlna-renderer.service.ts`

## Validation

Use the affected Nx targets:

```bash
pnpm nx test ui-playback --runInBand
pnpm nx test electron-backend --runInBand --testPathPatterns=dlna-renderer.service.spec.ts
pnpm nx test electron-backend --runInBand --testPathPatterns=external-player-session-registry.spec.ts
pnpm nx test workspace-shell-feature --runInBand
pnpm nx test components --runInBand
pnpm run typecheck:ci
pnpm run i18n:check
```

Real-device validation still requires compatible hardware on the same network.
At minimum verify the menu state in both Electron and a secure PWA, then test
each available protocol with a direct public sample stream.
