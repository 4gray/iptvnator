# VOD Multi-Source

Finds the same movie in the user's other imported playlists, lets them switch
which one it streams from without losing the timecode, and turns the
playback-error screen into a recovery point.

The point is not choice for its own sake — it is rescuing a viewing when the
current source is dead, serves an unsupported codec, or buffers badly.

## Scope (v1)

|               |                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------- |
| Source types  | **Xtream ↔ Xtream only**                                                                          |
| Content       | Movies only — series are not offered a source chip                                                |
| Environment   | **Electron only** — the chip renders nothing in the PWA                                           |
| Auto-failover | Opt-in, **off by default** (`Settings.vodAutoFailover`); offered only on the built-in web players |
| Pin scope     | Per movie (a global portal priority is out of scope)                                              |
| Stream probe  | HEAD → reachable + latency, sent with the playlist's own playback headers. **No codec probing**   |

Stalker never reaches the `content` table (it would need a live authenticated
`get_ordered_list&search=` per portal), and M3U playlists are stored as a JSON
blob whose search path forces `content_type: 'live'`. Both are additive later
without changing the contracts — `VodSourceCandidate.portalType` already carries
`'xtream' | 'stalker' | 'm3u'` and discovery sits behind a service interface.

A probe answer is cached per _request_, not per URL: two playlists can share a
stream URL and require different headers, and one of them answering 403 says
nothing about the other.

`ffprobe`/`ffmpeg` are not dependencies of this app and are not bundled, so
`provenance: 'probe'` means reachability and latency only. There is deliberately
no feature flag for codec probing: it would gate a code path with no binary
behind it.

## The honesty rule

This is the part to preserve if anything here is refactored.

Every metadata value carries **where it came from**:

| provenance | produced by                                                                                                                                 | rendered as                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `api`      | `get_vod_info` — container, codec, audio, dimensions                                                                                        | plain tag                          |
| `parsed`   | regex over the title/filename                                                                                                               | tag prefixed `~`, warn colour      |
| `probe`    | HEAD → reachable + latency (retried as a ranged GET when the server answers 405/501, since plenty serve media over GET while refusing HEAD) | `ok` / `fail` status tag           |
| _absent_   | —                                                                                                                                           | **no tag at all** + a `check` chip |

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
3. **Empty beats wrong.** Quality is derived from pixel _width_, because
   letterboxed masters are cropped vertically — a 2.39:1 1080p film is 1920×800,
   and 800 alone is indistinguishable from a 1280×800 encode. With no width, a
   height is trusted only within 5% of a standard frame height; otherwise no tag
   is emitted. Below the HD widths the ranges stop working: 960×540 and 1024×576
   are two formats inside one 900–1199 range, 800×600 and 800×450 are neither
   480p nor each other, and 720 wide is NTSC 480p or PAL 576p depending only on
   the height. Those formats are therefore matched rather than bucketed, and an
   unrecognised shape returns nothing rather than a label that would be
   published as an `api` fact.

    A known height has to be consistent with the width **on every tier**,
    ranges included. Cropping only ever _removes_ lines, so a shorter frame is a
    letterboxed master of that format, while a taller one is a different shape:
    640×480 against 640×360 below, and 1440×1080 (anamorphic 1080) or 1600×900
    against the 720p range above. All of those get no tag. Bucketing HD widths is
    otherwise sound — the standard widths really are far apart — but only once
    the height is allowed to veto the answer.

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

| Concern                    | Location                                                               |
| -------------------------- | ---------------------------------------------------------------------- |
| DTOs, match key            | `libs/shared/interfaces/src/lib/vod-source*.ts`                        |
| Pin table                  | `libs/shared/database/src/lib/vod-source-pins.schema.ts`               |
| Discovery SQL              | `apps/electron-backend/.../operations/title-sources.operations.ts`     |
| Pin CRUD                   | `apps/electron-backend/.../operations/vod-source-pin.operations.ts`    |
| Probe handler              | `apps/electron-backend/src/app/events/stream-probe.ts`                 |
| Discovery / resolve / rank | `libs/portal/shared/data-access/src/lib/multi-source/`                 |
| Probe + pin clients        | `libs/services/src/lib/{stream-probe,vod-source-pin}.service.ts`       |
| Row / popover / chip       | `libs/ui/components/src/lib/vod-sources/`                              |
| Page wiring                | `libs/portal/xtream/feature/src/lib/vod-details/vod-multi-source-*.ts` |

### One picker, two places, two counts

The chip on the action row and the chip in the inline player's now-playing bar
are the same component, so both are handed the same `matchKind` and the same
`vodAutoFailover` value and both write the setting back. A copy that rendered
the toggle off while it was on — and did nothing when flipped — would be worse
than not offering it.

The two numbers around it are deliberately different, because their sentences
are: the details-page chip says "Sources N" and counts every copy across all
playlists — the total the popover lists, route copy included — while the
caption says "also found in N other playlists" and counts distinct
**playlists** (`alternativePlaylistCount`). The popover groups a portal's
three copies of a film under that one portal, so a badge counting playlists
would contradict the "All (N)" chip inside, and a caption counting streams
would contradict the grouped list it invites the user to open. (The in-player
chip still passes the alternatives count: its sentence is "N other places to
go", not "N copies exist".)

### The popover: anchoring and fit

The chip opens the popover **above** itself, right edges aligned, through a
CDK connected overlay with flexible dimensions. That combination is the whole
fit contract:

- The overlay's bounding box caps the panel to the space between the chip and
  the viewport edge (16px margin), and inside the panel only the source LIST
  scrolls — header, search, filter chips and the auto-failover footer are
  `flex: none`, so they stay visible however short the panel gets.
- The overlay's `minHeight` (280px) exists for the FLIP decision, not for
  sizing: when less than that remains above the chip, CDK skips the position
  and the panel opens below instead, tail mirrored. As an inline pane style
  that minimum would also stretch a two-source panel to 280px, so the pane
  classes neutralize it visually (`.vod-sources-pop--*`).
- The position strategy re-applies itself on window resize, so the cap and
  the flip both hold at any window proportion without component code.

### The popover: filters

The chip row composes with the host search (AND): **All (N)** resets the chip
filters and states the total copy count, **Available** keeps only sources
whose probe verified them, **HD+** keeps sources whose quality tag reads
1080p or better, and the language select is built from the languages actually
present in the list. Two of these encode a decision worth writing down:

- "Available" is strict: only `probe.status === 'ok'` passes. An unchecked
  source must never pass a filter with that name — and because checks are
  lazy, activating the filter while NO source anywhere has a verdict runs
  check-all itself rather than filtering against nothing.
- "HD+" reads the quality tag whether stated (`api`) or guessed (`parsed`).
  This is a deliberate, narrow exception to "guesses never drive decisions":
  the filter is a browse aid the user operates while looking at the `~`
  markers, not an automatic choice — and hiding a copy whose own title says
  1080p would make the filter look broken. Ranking and failover still go
  through `factualOnly()` and cannot see guesses.

When search or filters reduce the list, a muted "X of N" counter appears, and
groups with no matching copy disappear entirely.

### Where a row's language comes from

The language the select and the copy chips read is `vodSourceLanguage`
(`libs/shared/interfaces/src/lib/vod-source-language.util.ts`): the stream
title's own prefix when it has one, else the language the stream's categories
agree on. Both are parsed guesses — they feed browsing only, and neither
ranking, failover nor the dub warning can reach them (`factualOnly` and
`audioDiffersFactually` read other fields entirely).

`titleLanguagePrefix` accepts the three shapes panels actually write: a 2–4
letter Latin or Cyrillic tag (plus the five-letter `MULTI` marker) before a
pipe **or any of its Unicode lookalikes** (`¦`, `│`, `｜`, …— visually
identical to `|`, invisible to a literal match), a bracketed tag at the very
start (`[EN] Movie`), and an ALL-uppercase tag before a **spaced** dash
(`EN - Movie`). The dash form is stricter on purpose: dashes are ordinary
title punctuation, and "Up - the movie" or "X-Men" must not read as a
language. Strictness is tiered per form: only the legacy pipe form is taken
at its word, while a bracket or dash match must ALSO pass
`isKnownLanguageTag` — those positions are where quality and rip tags live
("[HD]", "[CAM]", "NEW - "), and since a title prefix outranks the category
language, a fabricated one would mask a real category-derived language and
get the row excluded by the very filter meant to find it.

Recognizing a prefix is only half the job: the same tag also has to be
STRIPPED by `normalizeTitleKeys`, or the tagged copy and the bare one never
match and the row is never discovered at all. Its leading-tag rule therefore
shares this file's pipe set (`PROVIDER_PIPE_CLASS`) and, on the pipe branch,
needs no space after the separator — so "EN │ Fallout", "EN|Fallout" and
"|FR|VO|Le dernier empereur" reach the same key as the bare title.

It stops there, and the asymmetry with the reader above is the point. A wrong
GUESS costs a junk option in a filter; a wrong STRIP corrupts a film's
identity everywhere the key is used. Measured against 1.27M real catalog
titles: making the pipe branch case-insensitive or Cyrillic corrupts 349 keys
and rescues none, because "Akira | 1988" and "Момо | Momo" put the film's own
name in the tag position; widening the dash branch to `–`/`—` amputates 14
subtitled titles ("1918 – A Batalha de Kruty"); and Cyrillic before a dash
does not occur at all. So normalization keeps its uppercase-Latin,
space-required form everywhere except the pipe separator itself, and the
reader is free to be permissive because the gate in front of its riskier
forms — and the fact that a row only appears once it HAS matched — keeps a
bad guess cosmetic.

The one case where the shape genuinely cannot decide is a strip that would
leave **no real word behind**. "IT - 65 (2023)" is the Italian copy of the film
"65"; "AKA - 2023" is the film "AKA" and its year. Same shape, opposite
readings, so the leading token is tested against a vocabulary instead —
`TRAILING_TAG_VOCABULARY` plus a prefix-only list (`NF`, `EX`, `NRC`, `AMZ`,
`D+`, `P+`, `OSN`, `VO`, …), with a compound read by its HEAD so the
open-ended `4K-<lang>` family works and "INU-OH"/"PC-4L" — real film names —
do not. Unknown token, wordless remainder: the title is kept whole. That
direction is chosen deliberately, because a refused strip costs one unmatched
copy while a wrong one produced a bare-year key; on the live catalog
AKA/BDE/BRO/OUT/WIL/IF all collapsed onto `"2023"` and were offered to each
other as alternative sources. Gating the case where a word DOES survive was
rejected for the mirror reason: it would strand every genuine tag the
vocabulary has not heard of.

"No real word" is decided by running the REST OF THE PIPELINE on the stripped
form and looking at what comes out — never by re-implementing what the later
stages remove. That is the load-bearing part of the design: every stage drops
something, so a guard that predicts them is a list to keep in sync, and each
omission is a silent collapse:

| title               | dropped by         | would key as |
| ------------------- | ------------------ | ------------ |
| `\|TA\| RRR - HEVC` | quality tag        | `""`         |
| `CAT - Multi ENG`   | trailing tag       | `""`         |
| `IF - 2024_sub`     | underscore tag     | `2024`       |
| `AKA --xyz`         | double-dash suffix | `""`         |
| `CAT - 2022 S01`    | season marker      | `2022`       |

All five fall out of one question asked of the real output, and a stage added
later is covered for free. The season check deliberately uses
`SEASON_SUFFIX_PATTERN` directly rather than `stripSeason`, whose
"never return empty" fallback would report a lone season marker as a surviving
word. A tag word sitting next to a real one is still part of the title
("EN - Sub Zero" → `sub zero`).

The vocabulary is evidence, not intuition. Each entry prefixes hundreds to
thousands of ordinary lettered titles in the real catalog; nothing is added
because it "looks like a streaming service" (MAX and HULU would qualify, and
"MAX - 2015" is a film). Deriving it from movies alone missed `AMZ`, `D+` and
`P+`, which broke Paramount+/Disney+ copies of the numeric series 1923, 1883,
24 and 9-1-1 — so validate any change over movies AND series: 83 keys fixed,
0 corrupted across 1,616,111 titles.

The category path exists because many panels tag the CATEGORY ("EN | Netflix",
"DE | Apple TV") and leave stream titles bare. Discovery returns every visible
category name a stream sits in, and the two query tiers get there
differently: the FTS tier already groups per `(playlist_id, xtream_id)` for
its window, so it joins them with `group_concat(cat.name, char(31))` —
`char(31)` because the default `,` appears inside real category names — while
the scan tier must NOT group. `content` is unique per
`(category, type, stream)`, so one stream in several categories is several
rows whose titles need not agree; grouping would let SQLite keep an arbitrary
one and the normalized confirmation would then reject a stream that a sibling
row would have matched. The scan therefore returns a row per category and the
names are merged per stream in TypeScript.

Either tier only ever sees the categories of rows the query MATCHED, so a
stream also listed under a localized title in another category can look
unanimous when it is not. Deliberate: the field is a guess feeding a chip and
a browse filter, and completing it is expensive — on a 3.9 GB catalog,
resolving every category through a correlated subquery takes discovery from
0.74 s to 2.0 s (a cost every detail-page open pays), and a second bounded
lookup for the same 60 streams takes 19.7 s, to correct a cosmetic guess in a
shape that occurs 0 times in 2.7M rows.

Either way
`unambiguousCategoryLanguage` reduces them: categories without a recognized
language prefix abstain, all prefixed ones must agree, and a conflict yields
nothing. Category prefixes must additionally pass `isKnownLanguageTag`.
Measured on a real catalog, that gate is what keeps "VOD" (5,245 movies),
"KIDS" (1,010), "SHOW" and "WWE" out of a list of LANGUAGES; "NEW |",
"TOP |" and "VIP |" are everyday shapes too, and `new`, `top` and `hot` are
even assigned ISO 639-3 codes — which is why the gate is an
`Intl.DisplayNames` check for two-letter codes plus a curated list for
longer tags rather than a registry lookup. Only the pipe title form stays
permissive: a tag before a pipe in a movie title is overwhelmingly a
language, and tightening the legacy form would drop filter options that work
today. The route's own row reads the one category the route arrived through
(`VodMultiSourceMovie.categoryName`), which is the visible one; it loads late
on cold/direct routes, so the host's same-key refresh
(`refreshRouteFacts`) overlays it — and provider facts — onto the existing
route row without a rediscovery.

### The popover: copy rows

Expanding "N copies in this playlist" lists EVERY copy of the group —
including the one the parent row already shows — as compact
`app-vod-source-copy-row`s indented under the parent's text column. The
playlist's name and monogram are not repeated: the primary text is the
provider's own raw stream title (mono), with the copy's parsed language
(`vodSourceLanguage` — title prefix first, category fallback) promoted to a
chip before it. The tag row shows only values that
DIFFER from the parent's copy (identical container/codec are omitted), so
what distinguishes a copy is the only thing on the line; the copy identical
to the parent shows a muted "same as above" note instead. The fuzzy-match
warning and the probe verdict are per-copy claims and always render. Each
copy row keeps its own check and play actions — play switches playback to
that exact stream and moves the active badge.

### Checks: bounded, remembered

"Check all" (and the Available filter's implicit one) fires one task per
unchecked source, and each task costs a live `get_vod_info` against a foreign
portal plus a HEAD at the stream. The host therefore runs at most **4**
checks concurrently (`createCheckQueue` in the vod-details folder); a row
flips to "checking" the moment it is asked for — which is also what dedupes a
second click while it waits for a slot.

Settled verdicts (`ok`/`fail`, never `unknown`) are remembered for 10 minutes
in the root-provided `VodSourceProbeCacheService`, keyed by source id — i.e.
per movie **and** per source. The per-movie controller dies with its detail
page, so without this every navigation away and back would re-contact every
foreign portal on the next check-all; with it, a rediscovery seeds untouched
rows from the cache and shows "available · 0.3s" again without a request. The
cache is in-memory only: a probe verdict is a claim about the present, and
persisting it across app launches would let a stale "available" outlive the
stream it described.

## Identity

Provider ids cannot key a pin — the same film has a different `stream_id` in
every portal, which is the problem being solved.
`buildVodSourceMatchKey()` produces `tmdb:{id}` when a usable TMDB id exists,
otherwise `title:{normalizedBase}:{year}` via the shared `normalizeTitleKeys`.

Enrichment adds BOTH identifying fields late, so the same movie can already be
pinned under any poorer form of itself:

| pinned when         | stored under          |
| ------------------- | --------------------- |
| after enrichment    | `tmdb:{id}`           |
| before the TMDB id  | `title:{base}:{year}` |
| before the year too | `title:{base}:`       |

`buildVodSourceMatchKeyCandidates` returns all three, most-trusted first.
Reading every alias is what keeps a late TMDB id from orphaning an earlier pin.

Three key sets, because reading, writing and deleting are different questions
(`pinKeysFor` builds all three so they cannot disagree):

| set      | contents                            | why                                              |
| -------- | ----------------------------------- | ------------------------------------------------ |
| `lookup` | every alias above                   | a pin may sit under any poorer form of the movie |
| `write`  | `tmdb:` + `title:{base}:{year}`     | keys that name exactly ONE film                  |
| `loaded` | the key the pin on screen came from | the only ambiguous row this session may retire   |

A write stores the decision under **every** key in `write`, and clears whatever
stale row is left over. Each half rules out the other's shortcut:

- Writing only the top key leaves the movie unfindable under its own poorer
  identity. A pin set while `tmdb:438631` was known is invisible to the next
  reopen, which starts out with nothing but a title and a year and asks for
  `title:dune:2021` — so the preference is ignored until enrichment lands, and
  permanently if enrichment is off or never answers. Storing it under both keys
  makes it readable at every stage of the same film's identity, and overwriting
  the poorer key is also what stops it from still naming the source the user
  just replaced.
- Spreading it across _every_ alias is not the fix either: the yearless form is
  shared by every remake, so a known-year pin stored there would answer for a
  different film — pin Dune (2021), open Dune (1984) before its year arrives,
  and it starts the 2021 source. That form is deliberately absent from `write`
  for exactly this reason; it stays readable and unwritten.

The renderer passes `write[0]` as the pin's own `matchKey` and the rest as
`aliasKeys`; `setVodSourcePin` upserts one row per key and retires the leftovers
inside the same transaction, so no key list can half-apply.

Known limit, inherent to addressing rows by key alone: a write can only touch
keys the renderer can _name_. Re-pin a film during a pre-enrichment window and
the `tmdb:{id}` row from an earlier, enriched session is not among them, so it
survives pointing at the old source — and outranks the title key once the id
arrives again. Nothing can enumerate it from the page's side; closing it needs a
reverse index from film to key. The window is small in practice (TMDB responses
are cached in `tmdb_metadata`, so a revisit usually resolves the id at once) and
does not exist at all with enrichment off.

A write stores the new key **before** retiring the old rows. The other order
destroys the stored preference and can then fail to replace it, leaving nothing
persisted while the row still shows the old pin; lookups are most-trusted-first,
so a leftover alias never outranks the key just written.

The pin a rediscovery reads is applied **immediately**, not after its source
lookup returns: holding that snapshot across the await lets it overwrite a pin
the user makes in the meantime, leaving the row and the primary Play naming a
source the database no longer holds. Applying it first makes the later write
simply win.

For the same reason a write or an unpin never _deletes_ the yearless alias on
spec: that row may hold another remake's preference. The single exception is
the row this session actually read, because the user is acting on the pin they
can see — and leaving that one would make an unpin come back.

The row only changes once the write lands. A pin the database refused is worse
than no pin at all — the icon promises the preference will be there next time,
and it will not be — so `togglePinnedSource` reports "nothing happened" and the
controller is left exactly as it was.

### Rediscovery vs. a new session

Two keys, deliberately, because the host has two different questions to answer
when enrichment lands:

- `vodMultiSourceMovieKey` covers title, year and TMDB id. Enrichment changing
  any of them **re-runs discovery** — that is how a yearless search gets its
  year and a `tmdb:`-keyed pin becomes findable.
- `vodMultiSourceSessionKey` is `playlistId:contentId` — the film itself. It is
  what decides whether that rerun is a _refresh_ or a _new session_.

A refresh keeps the controller: the source the user switched to stays active
(with the facts its resolve produced, rather than the catalog's guesses), the
tried set stays burned, the live position stays, and a switch already in flight
still commits. Rebuilding there would take the film off the source it is
actually streaming, and hand failover a clean slate for sources it has already
spent. Only a different film resets — including the tried set, which is what
makes failover terminate.

A rerun can also legitimately _drop_ the playing row: the year the enrichment
supplies makes the year gate reject a copy the yearless search had admitted
("Dune" 1984 while watching the 2021 film). Off the list is right — it is not
the same film. Off the screen is not, so `applyDiscoveredSources` keeps it as a
row and leaves it active; a caption naming a playlist that is not streaming
anything would be a lie about the one thing this feature exists to state.

## What the queries are allowed to miss

A source that exists but is never read is indistinguishable, to the user, from
one that does not exist — the chip simply does not appear. So:

- **The current playlist is excluded in SQL**, not afterwards. It routinely
  lists a film in several categories, and those rows would otherwise spend the
  FTS window before a single other playlist was read.
- **Duplicates collapse in SQL too**, for the same reason. One playlist can
  list a film in dozens of categories, and those rows rank identically, so
  `GROUP BY cat.playlist_id, c.xtream_id` runs before the limit. Collapsing
  them only in TypeScript afterwards cannot recover the playlists the window
  never reached.
- **Short titles scan on a word boundary, and take no window at all.** The
  trigram tokenizer cannot index tokens under three characters, so "Up", "It"
  or "Us" produce an empty `MATCH` and fall back to a scan. A substring scan
  matches "Titanic" and "The Italian Job" for "It", so the scan asks for the
  token as a word
  (`' ' || LOWER(title) || ' ' GLOB '*[^a-z0-9]it[^a-z0-9]*'`) and orders by
  title length (a match is the title plus decoration: "IT (2017) 1080p").

    The FTS path keeps its 60-row window because it ranks by relevance — the best
    rows are the ones it keeps. A scan cannot rank, so a window there would
    silently decide which valid sources the user may see, and it would not even
    buy anything: the GLOB cannot use an index, so SQLite reads every row either
    way and a `LIMIT` saves transfer, not work. What bounds the scan instead is
    its predicate: reaching it means NO token cleared the trigram minimum — a
    one-or-two-character title like "It", but also an all-short multiword one
    like "I Am" — and EVERY token must then appear as a word. Matching on the
    first token alone would return most of a large catalog for the confirmation
    pass to discard, which on the single database worker is real blocking.

    Like the `LIKE` it replaces it compares ASCII-lowercased text, so a non-ASCII
    short title is no better and no worse served than before.

Both remain necessary-not-sufficient filters: the two-tier normalized
confirmation still runs afterwards, so the looser query never admits "Upgrade"
for "Up".

One row inside the excluded playlist is kept when the caller names it
(`keepContentId`): a pin can point at another copy of the film in the playlist
being viewed, and dropping that row would leave the preference pointing at
nothing. The host therefore reads the pin BEFORE discovery. When that pin is
the route's _own_ row, the kept copy and `currentSourceRow()` are the same
stream, so `applyDiscoveredSources` drops the duplicate rather than listing it
twice.

### Same title, different film

The year gate applies to **both** match tiers, not just the year-stripped one.
`normalizeTitleKeys` strips bracketed segments wholesale — they usually hold
quality and language tags — so "Dune (1984)" and "Dune" normalize to the same
string and the exact tier would accept the remake without ever consulting a
year, ranked _above_ every fuzzy match. Discovery reads a bracketed year out of
the raw title first, and when both sides state a year and they disagree, it is
not the same movie. An unknown year still never blocks.

The two tiers read different years, though. The **base** tier accepts either
form, bracketed or trailing, because it has just stripped a trailing year and
that year is the only thing standing between "Dune 1984" and "Dune 2021". The
**exact** tier reads the bracketed form ONLY: reaching it means both titles are
the same string, so a trailing four digits belong to both, and weighing a number
that is part of the NAME against a release year out of metadata rejects the very
copy it was meant to confirm — "Blade Runner 2049" against a stated 2017
disappears the moment enrichment lands. Brackets are never part of a name, so
"Dune (1984)" is still rejected against 2021 on the exact tier.

Which is why the movie's OWN year is read with `releaseTagYear`, not
`extractYear`. The latter takes a year from anywhere in the title, which is the
right answer where a year is only a search hint that scoring will confirm — and
the wrong one here, where the year is part of an identity. "2001: A Space
Odyssey" is not a 2001 film: calling it one makes every genuine 1968 copy fail
the gate above, so the movie has no alternatives at all, and it moves the pin
key the moment enrichment supplies the real year. Only bracketed and trailing
forms count. The trailing form stays ambiguous on purpose ("Blade Runner 2049"
is a title, not a tag) — that is what the two-tier exact/base match is for.

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
the inline player and `WebPlayerView` survive, while `WebPlayerViewComponent`'s
effect starts a new playback application (the engine component is remounted
under a fresh token with the carried `startTime`) and clears the diagnostic.
Because the `WebPlayerView` host, not the engine shell, owns DOM fullscreen, a
fullscreen session survives the swap as well.

Three details make the position survive:

- The carried position is the **live** one. `handleInlineTimeUpdate` reports to
  `VodMultiSourceHostService.reportPosition()` _before_ the 15-second
  persistence throttle, so a switch does not rewind by up to 15 seconds.
  External players have no `timeupdate` at all, so for them the polled
  `playback_positions` value IS the live one and is reported directly —
  seeding it would freeze the resume point where playback started.
- It is a single `.set()`, never `null` then set — a null in between would
  destroy the whole player subtree, including the `WebPlayerView` host that
  owns fullscreen.
- `playback_positions` is keyed `(playlistId, contentXtreamId, contentType)`, so
  a switch changes the key. The resolved playback carries the **new** source's
  `contentInfo`, and that source's row takes over.

The position also has to exist _before_ anything plays. Nothing reports a live
one until the first `timeupdate`, so a pinned source started straight off the
Resume button would resolve at zero and restart the film. The controller is
therefore seeded from the persisted position (`seedResumeSeconds`), one-way:
once a live position exists it wins, because the stored one lags it by up to
the save throttle and applying it would visibly rewind.

A resuming engine can emit a `timeupdate` at ~0 before it finishes seeking.
`VodDetailsPlaybackService` guards this with a one-shot `resumeSettled` latch —
a filter would have broken deliberate seek-backwards. The latch also releases
when the target is out of reach: switching a two-hour position into a
90-minute cut means the engine can never report it, and waiting would suppress
every save for the rest of the session. `handleInlineTimeUpdate`
returns that verdict and the route feeds multi-source the `startTime` it asked
for until the engine gets there, so a switch or a failure during the initial
seek does not resolve the next source at zero and restart the film. One latch
serves both, because two would eventually disagree.

## Failover

Only fires when `Settings.vodAutoFailover` is on, and it first awaits a
discovery still in flight — a stream can fail faster than SQLite answers, and
concluding "nowhere to go" against an empty controller would strand the user on
the error screen with alternatives landing a moment later. `stillOwnsScreen()`
does that wait and then re-checks the session, because the user can navigate
during it and the controller afterwards may belong to a different film; the
pinned-Play path takes the same wait, or a persisted pin would lose to worker
latency.
Ranking (`pickFailoverTarget`):

1. never tried this session — a **hard filter**, not a preference
2. probed reachable; probed failing is penalised
3. not known to have failed recently
4. richer **factual** metadata (via `factualOnly`)
5. exact title match over fuzzy

Termination is structural: `triedSourceIds` only ever grows within a session, so
an N-source movie fails over at most N−1 times and then shows the honest error
screen. Returning to an earlier source by hand does not clear the set.

Selection is not an attempt. `setActiveSource` only selects; `markPlaying` also
spends the source's turn, and only the three places that really start playback
call it — a switch, the route's own Play/Resume, and restoring the playing row
after a rediscovery. Discovery selects the route's row the moment the page
opens, and a pin or the picker can select an alternative before anything plays;
counting those would let a later failure skip a healthy fallback, or call the
options exhausted with one untouched. `runFailover` then retires whatever is on
screen before picking, so the source that just failed is spent however it got
there — one hole per start path would be an infinite ping-pong between two
sources.

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
shared diagnostics and owns its own error block. External MPV/VLC use managed
Electron sessions: recovery actions and the global dock report their exact
launch state without retaining playback headers or credentials.

## External players and an alternative source

A switch goes through the same inline-vs-external fork a normal Play takes, so
with MPV or VLC configured the alternative opens in the external player — and
that session carries the OTHER playlist's ids. `matchedExternalPlayback` would
disown it: the primary button never became Stop, stopping found no session, and
another click opened a second player. The page therefore claims a session that
matches either the route's own stream or the alternative multi-source says is
active (`VodDetailsPlaybackBindings.activeSource`). It also claims the
credential-free destination identity before awaiting the Electron launch: the
primary action becomes pending immediately, and a launching or closable-error
session remains matched before the controller can truthfully mark it active.
Restart and the provider-source shortcut read the same local pending state, so
a second activation cannot enter the Electron launch before the first IPC
response exists; their DOM controls stay mounted and disabled to preserve focus.
The diagnostic-fallback handler makes that same route-scoped ownership claim
before invoking MPV/VLC, rather than relying on the later controller commit. It
also supersedes an older source resolution at that acceptance boundary, so the
late switch cannot close and replace the newer diagnostic fallback.
That retained destination is scoped to the initiating playlist/VOD route key,
so Angular route reuse for a different movie cannot turn its Play action into
Stop for the previous movie's still-running external session. That new route's
Play and Resume actions still pass through the shared close-before-replacement
path, and they recheck their captured route key after teardown, so starting it
cannot leave the prior detached player running or launch stale content after
navigation. A diagnostic fallback that resolves after route reuse closes its
exact returned session instead of adopting it on the new route.

Before an external alternative replaces another external session, teardown of
the exact old process must be confirmed. If close fails or times out, the
replacement is cancelled instead of allowing two external players to overlap.
If the old launch is still opening and has no exact closer yet, a source-row
replacement is denied before either the multi-source switch token or playback
generation advances; the only in-flight launch therefore remains owned and is
not closed as superseded.
Once that old session is closed, later duplicate Stop/Close delivery is a
terminal no-op and cannot invoke its saved closer against a newly started MPV
or VLC process.
The controller commits the destination row, previous-source pointer, and switch
notice only after the playback seam accepts that handoff and an external
Electron launch resolves, so a rejected close or launch leaves the old source
as the truthful selection. The host's exact switch-owner probe crosses that
seam too: after teardown but before applying playback, the route rechecks it so
a newer unresolvable selection cannot leave the older player launched but
disowned by the controller.

`ownsContent()` answers that question once, for both consumers: the session
matcher AND the playback-position bridge. They cannot be allowed to disagree —
a page that shows a Stop button for a session whose progress it discards keeps
the resume point at wherever playback began, so a switch an hour later rewinds
the whole session.

The caption itself appears only while a player is actually running — inline or
a matched external session, and not while a playback diagnostic is up.
Discovery marks a source active as the page opens, so gating on that alone
would have the page claim "Playing from …" before Play was pressed, after the
player was closed, and over the error screen for a stream that would not
play.

Whichever source ends up playing, the "playing" badge follows it: starting the
route's own stream (Play, Resume, Restart, or the fallback after a pin does not
apply) hands the badge back to the route row, or the picker and caption go on
naming an alternative that is no longer running. That hand-back also
invalidates a switch still resolving — the user chose the route stream, and an
older resolution arriving afterwards would replace what they just asked for. And a source started through
the picker or a pin is recorded in Recently Viewed exactly as an ordinary Play
is — it is the same film, watched.

Stop then has to win over the pin. The primary action consults the pin first —
that is what makes "make this the main source" decide where playback starts —
but when a session is already running the same button reads Stop, and doing
anything other than stopping would launch a second player while the first kept
going.

## PWA

Discovery, foreign-playlist reads, the pin table and the probe are all
main-process. A browser HEAD to an arbitrary IPTV host is CORS-blocked, and
`no-cors` yields an opaque response where 200, 403 and 404 are
indistinguishable — so the PWA cannot answer these questions honestly rather
than merely lacking a convenience.

Every entry point is gated on a bridge `typeof` check (`isAvailable`), matching
`CatalogTitleMatchService`. In the PWA the chip renders nothing and the
auto-failover setting is hidden.

## Resuming a pinned copy

Playback positions are keyed by (playlist, stream), so a pinned alternative
carries its own. `playPinned` looks that position up and applies it — and
applies **zero** when the lookup comes back empty, because the controller is
still holding the ROUTE copy's position at that moment. Carrying it across
would drop the user into the middle of a film they never started here, and the
first save would write that timecode under the pinned source's key.

When no lookup function is supplied at all, nothing is applied: "never watched"
was never established, so there is nothing to correct.

## What the primary button describes

Two position signals, not one. `vodPlaybackPosition` is the LAST position
seen — whichever copy produced it — and feeds the progress bar and the switch
handoff. `routePlaybackPosition` is the route copy's own row, and everything
that acts on the route's stream reads that: Resume, its label, its timecode.
Collapsing them lets an alternative's progress resume the route copy at a
timecode nobody reached in it. Route reuse (the Similar rail) clears
both, so the button cannot describe the previous movie while the new lookup is
still in flight, and every route start — including the primary button's
fall-through past an unresolvable pin — goes through the route's own wrappers,
which replace whatever timecode an alternative left in the controller.

While the pinned copy is the one playing, its live position wins over the row
that was stored before this session started.

A pin means the button plays a copy the page did not load a position for. A
watched-through copy resolves to zero rather than its stored seconds, through
the same `isResumablePosition` rule the label uses — otherwise the button reads
Play and then seeks back to where the film ended. Restart follows the pin for
the same reason: with Resume honouring a pinned copy, a Restart that started
the route copy would silently switch the user's playlist.
`createPrimaryActionPosition` therefore looks that copy's row up and lets it
govern the label, the timecode and the Restart affordance — including when the
lookup comes back empty, because "never watched" is an answer: the button must
read Play, not `Resume 42:18` on a stream that starts at zero. A pin on the
route's own row changes nothing; the loaded position already IS that copy's.

## Provider codec metadata

`info.video` / `info.audio` come back in two shapes: the declared string array
(`['H.264']`, which the mock server and many panels send) and the ffprobe
object carrying `codec_name`/`width`/`height`. `readStreamInfo` accepts both —
reading only the object silently lost the codec on every array response.

That codec is a **display** fact and nothing more. The "dub may differ" warning
reads `audioLanguage`, which comes from the track's language tag
(`info.audio.tags.language`, or `language` on panels that hoist it) and never
from `audio`. A codec cannot answer the question the warning asks: AAC and AC3
routinely carry the same dub, and two AC3 tracks can carry different ones, so
comparing codecs fired on every identical-language re-encode and stayed silent
on the dub changes it exists for. Wrong in both directions is worse than
absent, because a warning people learn to ignore is not a warning. Few panels
tag a language at all, so in practice it is usually silent — which is the
honest state, and the same one the rest of this feature takes when it does not
know.

Switching sources through `startResolvedPlayback` closes the external session
it LAUNCHED first — tracked separately so refreshes and overlapping handoffs
cannot disown it within the same route session. The retained identity is ignored
after the playlist/VOD route key changes. Only after that exact teardown, the
host ownership checks on both sides of the launch await, and an `opened` or
`playing` launch result does the controller commit the destination. A launch
that loses ownership while IPC is pending is closed by its exact returned
session; a Stop that wins the race returns `closed` and is never committed. A
partial reusable-player handoff that leaves a closable error retains its
destination identity so the next source switch closes that exact process before
trying again. A stale launch whose exact close fails retains the same
credential-free identity for another close attempt. Direct route Play/Resume
supersede an older source resolution before waiting for teardown, but update the
active-source badge, playback evidence, and controller position only after the
new start succeeds. With MPV or VLC and instance reuse off, applying playback
earlier would spawn a second detached player, leaving both sources running and
Stop owning only the newer one.

## Short titles and Unicode

The title index folds diacritics. `content_title_fts` is created with
`tokenize='trigram remove_diacritics 1'`, because matching compares NORMALIZED
titles ("Amélie" → "amelie") against an index built from the raw one — without
folding, every accented title was invisible to the FTS path, and two identical
`Amélie` entries produced no candidates at all. The tokenizer is fixed at
CREATE time, so existing databases are recreated and rebuilt once behind
`migration:content-title-fts-remove-diacritics:v1`.

`remove_diacritics` needs SQLite 3.45+. The migration probes support on a temp
table first and does nothing when the runtime rejects it, leaving the working
index in place — and does NOT record itself as done, so a later app version
shipping a newer SQLite upgrades then. (better-sqlite3 currently bundles 3.53,
so the fallback is defensive rather than a path anyone is on.)

The completed marker is not taken as proof. `createTables` declares this table
too, with the plain tokenizer, and `CREATE TABLE IF NOT EXISTS` would recreate
it unfolded if it ever went missing after the marker was written — leaving two
sources of truth for one tokenizer. The migration therefore reads the live
table's own DDL out of `sqlite_master` and rebuilds unless it really folds. A
degraded index is otherwise invisible: discovery simply stops finding "Pokémon"
for "pokemon", with nothing to indicate it should have.

**Case folding for non-ASCII, on the FTS tier, is still not possible.**
`LOWER()` and the trigram tokenizer both fold ASCII only, so a Cyrillic title
stored with different capitalisation in two playlists ("ОН" vs "Он") cannot be
folded by the indexed path. Closing that needs a stored normalized-title
column, which is deliberately out of scope here.

The **scan** tier does fold it, because GLOB character classes are _not_
ASCII-only — `patternCompare` reads them as UTF-8 code points, and
`'Он' GLOB '*[Оо][Нн]*'` is true. `caseInsensitiveGlobPattern` therefore folds
the case in JavaScript, where Unicode case mapping is real, and hands SQLite one
class per character.

A letter can have more lowercase spellings than case mapping reaches from any
one of them: Greek `Σ` lowercases to `σ`, but a word-final sigma is written `ς`
and is equally a lowercase of it, and neither `Σ` nor `σ` arrives at `ς`. Each
class is therefore built from a **fold group** — every character sharing an
uppercase form — so every spelling reaches every other one. A request for `ΑΣ`
finds a stored `Ας`, which the earlier one-way reach (`ς` found `Σ` and `σ`, but
never the reverse) did not: uppercase is just as typeable as lowercase, so
"`ς` only occurs word-finally" never justified the asymmetry.

`CASE_FOLD_GROUPS` is derived by scanning the cased ranges at module load, the
same way `ACCENTED_BY_BASE` is, rather than tabulating pairs by hand — so it
generalises past sigma on its own: dotless `ı` folds with `i`, the long `ſ` with
`s`, and the historic Cyrillic letterforms with `В Д О С Т Ъ Ѣ`. Only the groups
a per-character fold would miss are kept, 24 of 767, since the rest are just
{upper, lower} and add nothing. Widening a class only ever costs candidate rows:
the scan is a necessary-not-sufficient filter and `normalizeTitleKeys` is what
confirms a match.

**Admitting a candidate is only half of it.** A class that admits a row the
confirmation then rejects finds nothing, so sigma has to be folded on both
tiers. `normalizeTitleKeys` therefore rewrites `ς` to `σ` after lowercasing.
This is not symmetry for its own sake: `toLowerCase` picks the form by
position, so `"ΑΣ"` arrives as `"ας"` while an already-lowercase `"ασ"` stays
medial, and the same word reaches the comparison spelled two ways.

Both SQL tiers were already folding them together — SQLite's trigram tokenizer
does full Unicode folding natively (unlike `LOWER()`, which is ASCII-only), and
the scan's GLOB classes now do it in JavaScript. The confirmation was the only
tier that did not, which made this a **pre-existing gap on the FTS path too**,
not just on the scan: a stored `"ο αρχοντασ"` was returned as a candidate for
`"ο αρχοντας"` and then discarded. Folding to the medial form is what Unicode
case folding does.

It returns `null` — leaving the substring tests as the whole answer — for a
token holding a GLOB metacharacter (SQLite GLOB has no escape character, so an
unescaped `*` would become a wildcard matching every row) or a case mapping that
changes length (`ß` uppercases to `SS`, `İ` lowercases to two code points).
Neither has a single-character class that means the same thing, and a wrong
pattern is worse than an absent one.

The ASCII/Unicode branch is decided from the RAW token, not the normalized one:
normalization folds diacritics, so "Ça" arrives as "ca" and looks like plain
ASCII while the stored title still reads "Ça". ASCII tokens keep the
word-boundary GLOB (what stops "it" matching "Titanic"). The non-ASCII branch
keeps both substring tests alongside the folded class, because the class is
built from the raw token and cannot match across a diacritic difference, which
the folded-token test does. It has no word boundary — `[^a-z0-9]` would treat
every Cyrillic letter as a separator — so it is looser, and the normalized
confirmation afterwards is what makes looser safe.

## Claims about the present

`isActive` means "the source a switch or Play would use" — selection, not
playback. `pinnedSourceAwaitingPlay` therefore takes `playbackLive` as well:
a pinned row stays selected after its player is closed, and skipping the pin
on selection alone would send the next Play to the route copy. Discovery sets it the
moment the page opens, and it survives closing the player — so it cannot, on
its own, back a statement in the present tense.

`VodDetailsRouteComponent.playbackLive` is that statement. Inline, it needs a
`timeupdate`: `inlinePlayback()` is only the REQUEST to play, non-null while
the engine is still opening the stream and still non-null after it fails, while
a timeupdate is the engine reporting frames. External, it needs the session
past `launching`. Every path that mounts a stream clears the latch first —
Play, Restart, and a source switch, which puts a DIFFERENT stream into the
same host and so cannot inherit the old one's evidence.

Two things read it, and they must agree: the "Playing from" caption, and the
source row's badge — which reads `Current` when a source is merely selected and
`Playing` once one really is.

## Where the route's code lives

`VodDetailsRouteComponent` is a thin host. The multi-source concerns it grew
live in `VodDetailsMultiSourceUiService` (component-provided): the
`playbackLive` evidence, the caption, the primary button's position, the
source actions, and the failover toast. The "Similar" rail and offline
downloads sit in their own component-provided services beside it.

## Backup

`playPinnedSource` reports `played` / `superseded` / `unavailable`, and only
`unavailable` may fall through to the route source. Collapsing the first two
meant a double-click on Play — where the second attempt supersedes the first —
had the losing attempt conclude "no usable pin" and start the route stream over
the playback the winning one had just begun. Same distinction as `runFailover`'s,
for the same reason.

A pin is written under every key naming its film, and its stale aliases retired,
in ONE transaction (`setVodSourcePin(db, pin, retireKeys, aliasKeys)`). Split in
two there is no honest outcome for a half-failure: a surviving alias is read
before the canonical key on the next open, so reporting success starts the
source the user just replaced — while reporting failure leaves the canonical row
durable and the UI showing a pin that is no longer the stored one. A call with
no usable key reports failure rather than claiming a preference it never wrote.

Pins ride along with playlist backup, under the playlist they point at, as the
optional `sourcePins` collection. See
`docs/architecture/playlist-backup-restore.md` for the remapping and
sanitizing rules — the short version is that `matchKey` names the film and
survives as-is, while the playlist id becomes the imported copy's.

Both restore routes use the same atomic replacement: the direct backup restore
and the parked replay after a fresh Xtream import call
`VodSourcePinService.replaceForPlaylist`, whose worker operation clears the
playlist's pins and inserts the complete restored set in one transaction. For
direct restore, that preserves the existing pins if an insert fails. A fresh
import has no pre-existing pins to lose; there it prevents a partially applied
prefix from being visible before the parked state is retried.

The parked state is consumed only after that atomic replacement succeeds, and
its removal is verified (with an empty tombstone as the safe fallback when
storage removal fails). Consumption compares the current parked snapshot with
the one that was applied. Store-owned replay and direct backup restore share a
playlist-scoped FIFO coordinator and consume a revision captured for the
content generation they restored. Duplicate consumers of that revision
coalesce, while a newer revision remains parked for its own post-import
consumer; an older asynchronous replacement therefore cannot clear or finish
after a newer one. Parking is verified before an import can report success, and
whole backup imports are serialized as well. Either restore path reports a
failed import instead of claiming success when consumption cannot be
confirmed. Fresh-import initialization stays blocked and retryable on either
failure. Cached content is not exposed while parked state exists: a complete
active initialization must restore and retire the snapshot before the catalog
opens, because a scope-limited offline cache may not contain every identity
referenced by the backup. Route bootstrap and Settings import completion
reconcile that gate before content can be edited. The active content route also
stays unmounted while replay is pending, and the import overlay follows the
full initialization session (including cache-only retries), not only
remote-download events.

## Which engines can fail over

Only the built-in web players (HTML5, Video.js, ArtPlayer) raise the playback
diagnostic that reaches `onPlaybackFailed()`. `WebPlayerViewComponent`
suppresses it for Embedded MPV, and external MPV/VLC never mount that component
at all — a stream that dies there is invisible to the app.

So the toggle is hidden, not merely inert, on those engines: in
`Settings > Playback` (`reportsPlaybackFailures()` gating the row) and in the
sources menu (`autoFailoverSupported`). Leaving it visible would let a user
switch on a feature that can never fire. The stored preference is untouched by
the change — switching back to a web player restores whatever was set.
