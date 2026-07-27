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
| `probe` | HEAD → reachable + latency (retried as a ranged GET when the server answers 405/501, since plenty serve media over GET while refusing HEAD) | `ok` / `fail` status tag |
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

### One picker, two places, two counts

The chip on the action row and the chip in the inline player's now-playing bar
are the same component, so both are handed the same `matchKind` and the same
`vodAutoFailover` value and both write the setting back. A copy that rendered
the toggle off while it was on — and did nothing when flipped — would be worse
than not offering it.

The two numbers around it are deliberately different, because their sentences
are: the chip says "Sources N" and counts alternative **streams**, while the
caption says "also found in N other playlists" and counts distinct
**playlists** (`alternativePlaylistCount`). The popover groups a portal's three
copies of a film under that one portal, so counting rows there would contradict
the list the caption invites the user to open.

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

### Rediscovery vs. a new session

Two keys, deliberately, because the host has two different questions to answer
when enrichment lands:

- `vodMultiSourceMovieKey` covers title, year and TMDB id. Enrichment changing
  any of them **re-runs discovery** — that is how a yearless search gets its
  year and a `tmdb:`-keyed pin becomes findable.
- `vodMultiSourceSessionKey` is `playlistId:contentId` — the film itself. It is
  what decides whether that rerun is a *refresh* or a *new session*.

A refresh keeps the controller: the source the user switched to stays active
(with the facts its resolve produced, rather than the catalog's guesses), the
tried set stays burned, the live position stays, and a switch already in flight
still commits. Rebuilding there would take the film off the source it is
actually streaming, and hand failover a clean slate for sources it has already
spent. Only a different film resets — including the tried set, which is what
makes failover terminate.

A rerun can also legitimately *drop* the playing row: the year the enrichment
supplies makes the year gate reject a copy the yearless search had admitted
("Dune" 1984 while watching the 2021 film). Off the list is right — it is not
the same film. Off the screen is not, so `applyDiscoveredSources` keeps it as a
row and leaves it active; a caption naming a playlist that is not streaming
anything would be a lie about the one thing this feature exists to state.

## The candidate window

Both queries take a bounded number of rows, so what fills that window decides
whether an alternative is findable at all:

- **The current playlist is excluded in SQL**, not afterwards. It routinely
  lists a film in several categories, and those rows would otherwise spend the
  budget before a single other playlist was read.
- **Short titles scan on a word boundary.** The trigram tokenizer cannot index
  tokens under three characters, so "Up", "It" or "Us" produce an empty `MATCH`
  and fall back to a scan. A substring scan matches "Titanic" and "The Italian
  Job" for "It", and enough of those sorted by title push the real film out of
  the window — so the scan asks for the token as a word
  (`' ' || LOWER(title) || ' ' GLOB '*[^a-z0-9]it[^a-z0-9]*'`), orders by title
  length (a match is the title plus decoration: "IT (2017) 1080p"), and gets a
  wider budget than the relevance-ranked FTS path. Like the `LIKE` it replaces
  it compares ASCII-lowercased text, so a non-ASCII short title is no better and
  no worse served than before.

Both remain necessary-not-sufficient filters: the two-tier normalized
confirmation still runs afterwards, so the looser query never admits "Upgrade"
for "Up".

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
a filter would have broken deliberate seek-backwards. `handleInlineTimeUpdate`
returns that verdict and the route feeds multi-source the `startTime` it asked
for until the engine gets there, so a switch or a failure during the initial
seek does not resolve the next source at zero and restart the film. One latch
serves both, because two would eventually disagree.

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
and failover **continues to the next candidate** rather than giving up —
production calls `failover()` only once, on the original failure, so stopping at
a dead top-ranked source would strand every healthy one below it. `switchTo`
therefore reports which of two things happened: `unresolvable` (marked tried,
keep going) or `superseded` (something newer owns the screen, stop). Without
that distinction the loop would spin on a superseded target forever, because
only the first outcome marks the candidate tried.

**A pin is not decoration.** The primary Play action starts from the pinned
source when one is set, and the pin outranks every other signal in the ranking
above. Loading a pin that only decorated its row would mean "make this the main
source" survived a restart as an icon and nothing else.

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
