# Embedded Inline Playback

This document records the current contract for embedded playback in portal detail views.

## Summary

- Embedded web players are `videojs`, `html5`, and `artplayer`.
- External players are `mpv` and `vlc`.
- Live playback stays inline in dedicated live layouts.
- VOD and series detail playback now also stays inline on canonical detail surfaces.
- Material dialog playback remains only as a fallback for older non-detail callers.

## Scope

The first pass is intentionally limited:

- Xtream VOD detail route
- Xtream series detail route
- Stalker VOD detail view
- Stalker series detail view

Not migrated in this pass:

- Generic non-detail playback entry points that still call `PlayerService.openPlayer(...)`
- Any collection/search surface that does not host a canonical detail surface of its own

## Components

Shared inline player shell:

- `/Users/4gray/Code/iptvnator/libs/ui/components/src/lib/portal-inline-player/portal-inline-player.component.ts`

Xtream detail hosts:

- `/Users/4gray/Code/iptvnator/libs/portal/xtream/feature/src/lib/vod-details/vod-details-route.component.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/xtream/feature/src/lib/serial-details/serial-details.component.ts`

Stalker detail hosts:

- `/Users/4gray/Code/iptvnator/libs/portal/catalog/feature/src/lib/category-content-view/category-content-view.component.ts`
- `/Users/4gray/Code/iptvnator/libs/ui/components/src/lib/stalker-series-view/stalker-series-view.component.ts`

Fallback dialog path:

- `/Users/4gray/Code/iptvnator/apps/web/src/app/services/player.service.ts`
- `/Users/4gray/Code/iptvnator/libs/portal/xtream/feature/src/lib/player-dialog/player-dialog.component.ts`

## Playback Decision Rule

When a detail view starts playback:

1. Resolve or construct a typed playback payload.
2. Check the active player setting.
3. If the player is embedded, render the inline player inside the current detail view.
4. If the player is external, hand the same payload to `PlayerService` for MPV/VLC playback.

The detail host owns inline state. `PlayerService` is no longer the primary owner of UI playback state for canonical VOD/series detail screens.

## Typed Playback Payload

Shared playback payloads live in:

- `/Users/4gray/Code/iptvnator/libs/shared/interfaces/src/lib/portal-playback.interface.ts`

Types introduced:

- `PlayerContentInfo`
- `ResolvedPortalPlayback`

These provide a single shape for:

- `streamUrl`
- `title`
- optional thumbnail and resume start time
- playback-position metadata
- optional external-player headers and request metadata

## Xtream Behavior

Xtream detail views already own canonical routes, so they construct playback locally and decide inline vs external locally.

Behavior to preserve:

- resume/playback position continues saving from `timeUpdate`
- back navigation clears inline playback with the route
- favorites, recent, and search still route into canonical Xtream detail screens before playback

## Stalker Behavior

Stalker previously resolved playback and opened UI in the same method.

Current contract:

- `resolveVodPlayback(...)` returns a `ResolvedPortalPlayback`
- `createLinkToPlayVod(...)` remains as a compatibility wrapper for untouched callers
- canonical Stalker detail views use the resolver directly and decide inline vs external locally

This keeps:

- inline/store-state detail navigation intact
- series and VOD-as-series support intact
- non-detail callers working until they are migrated

## Playback Position Saving

The old dialog path saved playback positions from inside `PlayerDialogComponent`.

The new contract is:

- inline detail hosts listen to `timeUpdate`
- each host throttles saves
- each host persists via existing playback-position infrastructure

This avoids coupling inline UI state to a global dialog.

## Future Migration Rule

If a non-detail surface is converted away from dialog playback:

- give that surface a canonical inline host
- switch it to `ResolvedPortalPlayback`
- do not move portal-specific navigation into `PlayerService`

The preferred direction is view-owned inline playback, not a larger dialog manager.
