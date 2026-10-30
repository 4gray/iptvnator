# IPTVnator Player

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who bring their own IPTV playlists or portal accounts and want to watch
live TV, radio, movies and series. The maintainer confirmed that everyday viewers
and experienced IPTV users are equally important: keep the main viewing path
simple and advanced capabilities accessible.

## Product Purpose

This is IPTVnator's primary product and the main focus for product and design
work: one application under `apps/web`, used both in Electron and in the browser.
The TV client is a secondary experiment; the web remote is a secondary companion
to this player. Neither has equal product priority with the main application.

Connect users' sources, help them find something to watch, and play or resume it.
IPTVnator is a free, open-source player. It does not provide or sell subscriptions,
channels, playlists or other media content.

## Positioning

One player workspace brings together M3U/M3U8, Xtream Codes and Stalker/Ministra
sources, with live viewing, provider catalogs and personal collections.
Desktop playback options and a self-hosted browser runtime serve different
environments; their capabilities are not interchangeable.

## Operating Context

- This Angular application is both the Electron renderer on macOS, Windows and
  Linux and the installable browser PWA. Electron packaging does not make its
  interface a separate native iOS or Android product.
- Main journeys: add a source; browse or search; play a live channel or VOD;
  resume watching; organize favorites; manage sources and playback settings.
- Desktop can use built-in playback, external players and experimental embedded
  MPV. The desktop mobile remote is a separate companion application.
- The self-hosted PWA uses the web backend. Its server-backed library is shared
  between browsers opening the same instance.
- Development starts from the repository root with `pnpm run serve:frontend`
  or `pnpm run serve:backend` for Electron.

## Capabilities and Constraints

- Preserve provider-specific behavior and existing saved sources, favorites,
  history and resume positions. Do not assume playback engines support every
  provider or stream format equally.
- Electron-only capabilities include M3U XMLTV, managed external/embedded players,
  downloads and the desktop remote-control integration. Runtime capability
  contracts determine availability; browser views must reflect those limits.
- TMDB enrichment is optional and uses the user's own API key.
- Credentials must not appear in routine UI labels or diagnostics.
- The separate TV client and its phone setup form are not Angular player routes.

## Brand Commitments

Preserve the IPTVnator name, official project identity and distinction between
the player and content providers. The maintainer prohibits decorative vertical
side borders or accent strips, including shadow and pseudo-element imitations.

## Evidence on Hand

- [Repository overview and existing screenshots](../../README.md).
- [PWA runtime contract](../../docs/architecture/pwa-self-hosted.md).
- [Workspace journeys and navigation](../../docs/architecture/workspace-shell.md).
- [Existing UI guidance](../../docs/architecture/iptvnator-ui-guidelines.md).
- [Runtime capability implementation](../../libs/services/README.md).

These contracts and the current implementation remain authoritative for detailed
behavior. Demonstration channels and screenshots are not supplied subscriptions.

## Product Principles

1. Prioritize the main Electron/PWA player and its path from source to playback.
2. Keep advanced controls available without burdening the everyday viewing path.
3. Preserve personal library data and provider compatibility.
4. Make availability, connection failures and recovery actions understandable.
5. Respect the user's source credentials and optional metadata choices.

## Accessibility & Inclusion

Preserve localization, keyboard navigation, visible focus and accessible control
names. Existing light/dark themes and reduced-motion behavior must remain usable.
No additional accessibility certification target was established during init.
