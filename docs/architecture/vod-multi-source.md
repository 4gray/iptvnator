# VOD Multi-Source

Finds the same movie in the user's other imported playlists, lets them switch
which one it streams from without losing the timecode, and turns the
playback-error screen into a recovery point.

The point is not choice for its own sake — it is rescuing a viewing when the
current source is dead, serves an unsupported codec, or buffers badly.

## Scope (v1)

| | |
|---|---|
| Source types | **Xtream ↔ Xtream only** |
| Content | Movies only — series are not offered a source chip |
| Environment | **Electron only** — the chip renders nothing in the PWA |
| Auto-failover | Opt-in, **off by default** (`Settings.vodAutoFailover`) |
| Pin scope | Per movie (a global portal priority is out of scope) |
| Stream probe | HEAD → reachable + latency. **No codec probing** |

Stalker never reaches the `content` table (it would need a live authenticated
`get_ordered_list&search=` per portal), and M3U playlists are stored as a JSON
blob whose search path forces `content_type: 'live'`. Both are additive later
without changing the contracts — `VodSourceCandidate.portalType` already carries
`'xtream' | 'stalker' | 'm3u'` and discovery sits behind a service interface.

`ffprobe`/`ffmpeg` are not dependencies of this app and are not bundled, so
`provenance: 'probe'` means reachability and latency only. There is deliberately
no feature flag for codec probing: it would gate a code path with no binary
behind it.

## The honesty rule

This is the part to preserve if anything here is refactored.

Every metadata value carries **where it came from**:

| provenance | produced by | rendered as |
|---|---|---|
| `api` | `get_vod_info` — container, codec, audio, dimensions | plain tag |
| `parsed` | regex over the title/filename | tag prefixed `~`, warn colour |
| `probe` | HEAD → reachable + latency | `ok` / `fail` status tag |
| *absent* | — | **no tag at all** + a `check` chip |

Three rules follow, and each is enforced in code rather than by convention:

1. **A guess never ranks.** `factualOnly()`
   (`libs/portal/shared/data-access/.../vod-source-metadata.util.ts`) is the only
   sanctioned accessor for ranking and failover decisions, and `parsed` values
   are structurally unreachable through it. A filename claiming 4K cannot
   outrank a source that was actually reached.
2. **Unknown is not "unavailable".** `VodSourceProbeStatus` separates `fail`
   (contacted and refused) from `unknown` (timed out, blocked by the redirect
   policy, or no probe capability). A probe returning HTTP status `0` maps to
   `unknown`; the UI keeps offering a check and never shows the source as dead.
3. **Empty beats wrong.** Quality is derived from pixel *width*, because
   letterboxed masters are cropped vertically — a 2.39:1 1080p film is 1920×800,
   and 800 alone is indistinguishable from a 1280×800 encode. With no width, a
   height is trusted only within 5% of a standard frame height; otherwise no tag
   is emitted.

Provenance is per-field and changes over time: at discovery a row has only
`parsed` tags, because the `content` table stores no container, codec or audio.
Facts arrive when the source is resolved.

## Architecture

```
VOD details page (Xtream)
  └── VodMultiSourceHostService          component-provided, one per open movie
        ├── VodMultiSourceController     session state + failover ranking
        ├── VodSourceDiscoveryService ──► DB_FIND_TITLE_SOURCES (trigram FTS)
        ├── VodSourceResolverService  ──► foreign playlist creds → get_vod_info
        │                                  → constructVodUrl
        ├── VodSourcePinService       ──► DB_GET/SET/CLEAR_VOD_SOURCE_PIN
        └── StreamProbeService        ──► STREAM_PROBE_URL (main process)
```

`VodMultiSourceHostService` is **component-provided, never root-provided**: the
controller's "each source is tried at most once" set must die with the movie, or
a later film inherits a poisoned failover history.

`VodMultiSourceController` is a plain class, not a service, for the same reason —
and so its ranking logic is testable without TestBed.

### Ownership

| Concern | Location |
|---|---|
| DTOs, match key | `libs/shared/interfaces/src/lib/vod-source*.ts` |
| Pin table | `libs/shared/database/src/lib/vod-source-pins.schema.ts` |
| Discovery SQL | `apps/electron-backend/.../operations/title-sources.operations.ts` |
| Pin CRUD | `apps/electron-backend/.../operations/vod-source-pin.operations.ts` |
| Probe handler | `apps/electron-backend/src/app/events/stream-probe.ts` |
| Discovery / resolve / rank | `libs/portal/shared/data-access/src/lib/multi-source/` |
| Probe + pin clients | `libs/services/src/lib/{stream-probe,vod-source-pin}.service.ts` |
| Row / popover / chip | `libs/ui/components/src/lib/vod-sources/` |
| Page wiring | `libs/portal/xtream/feature/src/lib/vod-details/vod-multi-source-*.ts` |

## Identity

Provider ids cannot key a pin — the same film has a different `stream_id` in
every portal, which is the problem being solved.
`buildVodSourceMatchKey()` produces `tmdb:{id}` when a usable TMDB id exists,
otherwise `title:{normalizedBase}:{year}` via the shared `normalizeTitleKeys`.

Lookups pass **every** alias, most-trusted first
(`buildVodSourceMatchKeyCandidates`). A movie pinned before TMDB enrichment
landed is stored under its title key and prefers a `tmdb:` key afterwards;
reading both means the id arriving later does not orphan the pin, and unpinning
clears every alias so a stale row cannot resurrect it.

## Why resolution is lazy

The `content` table stores no `container_extension`, and
`XtreamUrlService.constructVodUrl` returns `''` without one. A discovered source
is therefore **not playable from the database** — every alternative costs one
live `get_vod_info` against a foreign playlist's credentials, which can fail
offline, on an expired account, or behind Cloudflare.

So: rows render instantly from the FTS match with `parsed` provenance, and a URL
is resolved only when the user clicks play, pins, or checks. Containers are
memoised per `(playlistId, streamId)` for the session, and a container learned
earlier is reused if the portal later goes unreachable. Resolution is never
fanned out on page load.

## Switching without losing the timecode

Every playback host renders `@if (inlinePlayback(); as playback)`, so re-`set()`ing
that signal with a new `{streamUrl, startTime}` swaps the source **in place** —
the player component, `WebPlayerView` and the engine all survive, and
`WebPlayerViewComponent`'s effect rebuilds the source and clears the diagnostic.

Three details make the position survive:

- The carried position is the **live** one. `handleInlineTimeUpdate` reports to
  `VodMultiSourceHostService.reportPosition()` *before* the 15-second
  persistence throttle, so a switch does not rewind by up to 15 seconds.
- It is a single `.set()`, never `null` then set — a null in between would
  destroy the player subtree and lose the engine.
- `playback_positions` is keyed `(playlistId, contentXtreamId, contentType)`, so
  a switch changes the key. The resolved playback carries the **new** source's
  `contentInfo`, and that source's row takes over.

A resuming engine can emit a `timeupdate` at ~0 before it finishes seeking.
`VodDetailsPlaybackService` guards this with a one-shot `resumeSettled` latch —
a filter would have broken deliberate seek-backwards.

## Failover

Only fires when `Settings.vodAutoFailover` is on. Ranking (`pickFailoverTarget`):

1. never tried this session — a **hard filter**, not a preference
2. probed reachable; probed failing is penalised
3. not known to have failed recently
4. richer **factual** metadata (via `factualOnly`)
5. exact title match over fuzzy

Termination is structural: `triedSourceIds` only ever grows within a session, so
an N-source movie fails over at most N−1 times and then shows the honest error
screen. Returning to an earlier source by hand does not clear the set.

A source that cannot even be resolved is marked tried without becoming active,
so it is not re-picked.

The switch is **always announced** — another source can carry a different dub or
cut. The toast offers Undo, and adds a dub warning when
`audioDiffersFactually()` is true, which requires **both** sides to state an
audio track as fact. Two guesses, or a guess against a fact, stay silent.

Web engines only (HTML5/hls.js, Video.js, ArtPlayer). Embedded MPV suppresses
shared diagnostics and owns its own error block; external MPV/VLC are
fire-and-forget with no error channel back.

## PWA

Discovery, foreign-playlist reads, the pin table and the probe are all
main-process. A browser HEAD to an arbitrary IPTV host is CORS-blocked, and
`no-cors` yields an opaque response where 200, 403 and 404 are
indistinguishable — so the PWA cannot answer these questions honestly rather
than merely lacking a convenience.

Every entry point is gated on a bridge `typeof` check (`isAvailable`), matching
`CatalogTitleMatchService`. In the PWA the chip renders nothing and the
auto-failover setting is hidden.
