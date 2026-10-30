# IPTVnator TV

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Viewers using their own IPTV sources on a television, navigating with a remote
or pointer. The maintainer confirmed that everyday viewers and experienced IPTV
users are equally important: make the main viewing path simple while retaining
access to advanced source and playback settings.

## Product Purpose

This is a secondary, experimental client. The main product and primary focus for
product and design work is the [Electron/PWA player](../web/PRODUCT.md) under
`apps/web`. TV support is not an equal-priority replacement for that application.

Let users browse, watch and resume their own live TV, movies and series on the
television. IPTVnator supplies the player, not channels or subscriptions.

## Positioning

A separate TV client supports M3U, Xtream Codes and Stalker/Ministra sources,
directional navigation, native television playback and phone-assisted setup.
It shares provider contracts with the wider project while retaining its own
runtime, navigation and local viewing state.

## Operating Context

- Preact and Vite build a web application packaged for webOS. The current
  approved device target is LG OLED55BX9LB on webOS 5.x / Chromium 68.
  Compatibility with other TV platforms is not established by this record.
- Users select or configure a backend, add sources, browse catalogs or the live
  guide, start playback, and return to favorites or continue watching.
- A matching IPTVnator web backend is required. Native stream compatibility
  depends on the device and provider.
- `apps/tv-setup` is the companion phone form for source and settings entry via
  a temporary setup session. It belongs to the TV workflow and is served by the
  web backend; it is different from the desktop mobile remote.
- Development starts from the repository root with `pnpm nx serve tv` on port
  4310, with a separately configured matching backend.

## Capabilities and Constraints

- Use the TV's native video adapter. The TV runtime excludes Angular, NgRx, RxJS,
  Electron and Node; desktop player integrations are not available here.
- Preserve Chromium 68 compatibility and packaged `file://` startup behavior.
- Backend selection and optional shared server sources are explicit user choices.
  Favorites, viewing history and resume positions currently remain local to TV;
  server sources do not imply cross-device viewing-state synchronization.
- Xtream and Stalker supply programme guides. M3U XMLTV, archive playback and
  DRM are outside the current TV scope.
- Focus and browsing must not start or replace playback. Preserve directional
  navigation, platform Back, modal focus ownership and return to the originating
  item after playback or detail navigation.
- Phone entry reduces reliance on typing with the television remote. Source
  credentials and resolved stream URLs must not be logged.
- Browser tests provide development evidence; they do not certify the real
  television's remote, codecs or native playback behavior.

## Brand Commitments

Keep the IPTVnator identity and distinguish TV playback from desktop remote
control. The maintainer prohibits decorative vertical side borders or accent
strips, including shadow and pseudo-element imitations.

## Evidence on Hand

- [TV architecture and current limitations](../../docs/architecture/tv-application.md).
- [Development and device validation](../../docs/development/tv-development.md).
- [TV phone setup application](../tv-setup/project.json).
- [TV companion deployment](../../docker/tv/README.md).
- [Existing TV entry point](src/main.tsx) and [TV feature implementation](../../libs/tv/feature/project.json).

## Product Principles

1. Keep the experimental TV scope subordinate to the main Electron/PWA product.
2. Keep source setup and everyday viewing simple, with advanced settings accessible.
3. Maintain predictable focus, Back behavior and deliberate playback actions.
4. Preserve local viewing data and source identity through reconnects and changes.
5. Judge TV readiness with actual device evidence as well as browser checks.

## Accessibility & Inclusion

Directional remote navigation, pointer input and stable, recoverable focus are
core interaction requirements. Preserve readable content at television viewing
distance and usable phone-based entry. No new accessibility certification or
additional device-support commitment was established during init.
