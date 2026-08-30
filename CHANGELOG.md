# Changelog

Releases **0.13.0 – 0.23.0** were published as
[GitHub releases](https://github.com/4gray/iptvnator/releases) and
[website posts](https://4gray.github.io/iptvnator/blog/) rather than collected
here. This file resumes from the next release onwards; the entries below are
kept as they were written.

New sections are generated from `.changes/*.md` and inserted directly below
this marker — see `.changes/README.md`.

<!-- next-release -->

# [0.23.0](https://github.com/4gray/iptvnator/compare/v0.22.0...v0.23.0) (2026-08-30)

### Features

- **dashboard** — Continue Watching cards on the dashboard now open the detail page on click, just like movie cards — no more accidental episode playback. Resuming the saved episode moved to a new ⋮ menu on each card, next to "Mark as Watched" and "Remove from history". ([#1469](https://github.com/4gray/iptvnator/pull/1469), closes [#1441](https://github.com/4gray/iptvnator/issues/1441))
- **dashboard** — Dashboard source cards now warn when a portal subscription is about to lapse: an amber "Expires in N d" chip appears within a week of the expiry date, and an "Expired" chip once it has passed. Xtream expirations come from the same cached status check the playlist switcher uses; Stalker portals reuse the account info saved at import. ([#1342](https://github.com/4gray/iptvnator/pull/1342))
- **dashboard** — The dashboard gains a "Because you watched" rail: TMDB recommendations seeded from your recently watched movies and series, showing only titles that actually exist in your imported libraries. It appears once at least five matches are found, can be turned off under Settings → Dashboard, and requires the TMDB metadata opt-in (desktop app only). ([#1419](https://github.com/4gray/iptvnator/pull/1419))
- **deps** — Linux desktops with client-side decoration support now show native rounded corners on the IPTVnator window. Desktop builds now run on Electron 43. ([#1414](https://github.com/4gray/iptvnator/pull/1414))
- **downloads** — The download manager got a visual cleanup: "Ready to watch" cards are compact poster cards — file actions live in the poster's ⋮ menu, and clicking any card (episodes included) opens its offline detail. Queue rows show one primary action (pause/resume/retry) with cancel and remove in the menu, and all sections share one heading style with item counts. ([#1448](https://github.com/4gray/iptvnator/pull/1448))
- **downloads** — Live-TV recordings made with the Embedded MPV player now live in the download manager: an in-progress row with elapsed time and Stop, a Recordings library with channel logos and the programs captured from the EPG at recording time, a focused detail page, and Needs attention when a file goes missing. Recordings interrupted by a crash survive as playable partials. ([#1452](https://github.com/4gray/iptvnator/pull/1452))
- **downloads** — Downloads now separate active transfers from a grouped offline library, move missing files to Needs attention with Download again, and open movies and series in focused offline details with saved metadata. Series show only local episodes; View in portal returns to provider playback when the source can be recovered. Completed-file checks stay responsive on slow or unavailable storage. ([#1313](https://github.com/4gray/iptvnator/pull/1313))
- **downloads** — Downloads can be paused and picked up later. A paused transfer keeps what it already fetched and continues from that point instead of starting over, and downloads cut short by a crash or a closed app come back as paused rather than lost. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **downloads** — Series downloads now let you queue several episodes in a row or add every available episode from the selected season. Already queued, paused, or downloaded episodes are skipped without duplicates, and the app reports the batch result. ([#1357](https://github.com/4gray/iptvnator/pull/1357))
- **embedded-mpv** — Experimental Embedded MPV can draw video inside the app window instead of into a separate layer pinned on top of it, so menus, dialogs and the player controls stop being swallowed by the picture. Available on macOS (Apple Silicon), Windows and Linux x64; switching it on needs a restart. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **epg** — Channels whose guide never matched can be mapped by hand: right-click a channel in any list and pick "Map EPG channel" to attach it to a channel from your uploaded XMLTV guide. The mapping is remembered and used everywhere the guide is read — M3U playlists, Xtream and Stalker portals alike. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **i18n** — IPTVnator speaks Hungarian, its 19th language — contributed by @htibcsike. ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#1192](https://github.com/4gray/iptvnator/issues/1192))
- **m3u** — MPEG-DASH channels play in the built-in player, ClearKey-encrypted ones included — the keys are read from the playlist's #KODIPROP lines, whether they sit above or below the channel entry. Streams locked with Widevine or PlayReady still cannot be played, but they now say so instead of failing silently. ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#86](https://github.com/4gray/iptvnator/issues/86), closes [#614](https://github.com/4gray/iptvnator/issues/614), closes [#656](https://github.com/4gray/iptvnator/issues/656), closes [#733](https://github.com/4gray/iptvnator/issues/733), closes [#752](https://github.com/4gray/iptvnator/issues/752))
- **playback** — The shared player controls' subtitle menu now loads external subtitle files (.srt/.vtt in the built-in web players, plus .ass in Embedded MPV), adjusts the subtitle timing offset in ±0.5 s steps, and sets the subtitle text size and color — size/color persist across sessions and are shared between engines. ([#1471](https://github.com/4gray/iptvnator/pull/1471), closes [#1408](https://github.com/4gray/iptvnator/issues/1408))
- **playback** — The built-in web players' shared controls gain a quality menu: multi-bitrate HLS and DASH streams can be pinned to a specific rendition ("1080p", "720p", …) or left on Auto, which keeps the player's adaptive selection. The menu appears only when the stream actually offers more than one quality, and the choice lasts for the current playback session. ([#1470](https://github.com/4gray/iptvnator/pull/1470))
- **playback** — The new player controls are now the default for the built-in web players — one consistent bar with quality selection, external subtitles, subtitle delay and styling, speed, and picture-in-picture. They are touch-friendly too: tapping the video shows or hides the controls instead of pausing, and narrow players get a two-row layout. Prefer the old look? Switch back in Settings > Playback. ([#1485](https://github.com/4gray/iptvnator/pull/1485), closes [#1408](https://github.com/4gray/iptvnator/issues/1408))
- **playback** — An optional new set of player controls that looks and behaves the same in the HTML5, Video.js and ArtPlayer players, with picture-in-picture and, in fullscreen, the name of what you are watching. Enable it in Settings → Playback; left off, each of the three keeps its own controls exactly as before. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **playback** — The inline player on movie and series pages fills the whole content area like a theater: the video sits centered in black instead of leaving a strip of app background beside it. In the built-in web players, an optional ambient mode fills that space with a blurred, dimmed copy of the poster. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **playback** — A series playing inline on a wide window shows an "Up Next" rail beside the video: the rest of the season and the start of the next one, the current episode highlighted, watch progress on every card. Click one to jump straight to it. Built-in web players only; switch the rail off in Settings → Playback. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **playlist** — The Add playlist dialog has a new "Auto-detect" method: paste whatever your provider sent you — links, Xtream credentials, a MAC address with device IDs — and IPTVnator recognizes the source type and fills the matching import form for you to review. Detection runs entirely inside the app; nothing you paste is sent anywhere. ([#1445](https://github.com/4gray/iptvnator/pull/1445))
- **playlist** — M3U entries that are movie files now open in the same movie detail view the portals use: playback starts immediately with plot, cast, rating and artwork from TMDB below the player instead of the empty program guide, and closing the player reveals the full poster page. Requires TMDB metadata to be enabled; a toggle in Settings → Metadata (TMDB) turns recognition off. ([#1420](https://github.com/4gray/iptvnator/pull/1420))
- **portals** — Year, genre, and country on movie and series detail pages are now clickable (with TMDB metadata enabled): each chip opens a Discover page of popular titles for that facet, marked with what's already in your library — matches jump straight to their detail page, the rest open the portal search. Works in Xtream and Stalker, like the existing actor and director chips. ([#1453](https://github.com/4gray/iptvnator/pull/1453), closes [#1449](https://github.com/4gray/iptvnator/issues/1449))
- **portals** — Movie and series details opened from the dashboard, global favorites, history, or a portal's favorites/recent tabs now offer a "View in portal" button below the main actions. It jumps straight to the title inside its own portal, with the matching category selected in the sidebar. ([#1422](https://github.com/4gray/iptvnator/pull/1422))
- **portals** — Opening a series now lands on the season you'd actually continue: the earliest season with unwatched episodes, or the latest season once everything is watched — instead of always starting at season 1. ([#1469](https://github.com/4gray/iptvnator/pull/1469), closes [#1441](https://github.com/4gray/iptvnator/issues/1441))
- **portals** — Series detail pages can now mark a whole season as watched (or unwatched) in one click — the new button next to "Download season" works for both Xtream and Stalker portals. Handy when you start a show mid-way: mark the earlier seasons watched and the Play button jumps straight to your next unwatched episode. ([#1447](https://github.com/4gray/iptvnator/pull/1447), closes [#1442](https://github.com/4gray/iptvnator/issues/1442))
- **portals** — The series pages' season header now has a ⋮ menu that marks the WHOLE series as watched (or unwatched) in one click, for both Xtream and Stalker portals. On Ministra portals that load seasons lazily, the app first fetches the remaining seasons and then marks everything — so catching up on a show you started mid-way is a single action. ([#1451](https://github.com/4gray/iptvnator/pull/1451), closes [#1442](https://github.com/4gray/iptvnator/issues/1442))
- **portals** — Movies that exist in several of your playlists now show a "Sources" chip on the detail page. Switch playlist mid-film and playback continues from the same timecode, pin a preferred source per movie, and when a stream dies the error screen offers the alternatives instead of a dead end. Optional auto-switching is off by default. ([#1286](https://github.com/4gray/iptvnator/pull/1286))
- **portals** — The movie page's Sources popup now always fits on screen — only the source list scrolls, and it flips below the button in short windows — and gains All / Available / HD+ / language filters ("Available" checks every source on first use). Expanded copies show the stream title with only what differs, availability results are remembered, and Favorites/Download became icon buttons with live progress. ([#1359](https://github.com/4gray/iptvnator/pull/1359))
- **remote-control** — The mobile remote now works in live TV favorites and recently viewed — per-portal and global — for M3U, Xtream and Stalker: channel switching, number select, and now-playing status follow the on-screen list. The remote no longer shows a channel as playing after leaving the player, Stalker radio reports its status, and volume buttons grey out when an external player owns the audio. ([#1399](https://github.com/4gray/iptvnator/pull/1399))
- **settings** — Settings sections are now separate pages with shareable URLs and a floating Save/Discard bar that appears only when you have unsaved changes; leaving settings with pending edits asks whether to save, discard, or keep editing. The EPG panel's "Open EPG settings" button now jumps straight to the EPG settings page. ([#1384](https://github.com/4gray/iptvnator/pull/1384))
- **settings** — A new setting drops the country prefix from live channel names, turning "UK - BBC One" into "BBC One" in lists, the guide and the player. Movie and series titles are left alone, and names that only look like a prefix — "Sky - Sports F1" — stay intact. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **stalker** — Stalker portals now have an Account info dialog — subscription status, tariff plan, expiry date with a days-left counter, login, and portal details. Open it from the header playlist menu, the dashboard source card, or the command palette, same as for Xtream. If the portal is unreachable, the data saved when the portal was added is shown instead. ([#1330](https://github.com/4gray/iptvnator/pull/1330))
- **stalker** — Stalker portals that ask for a login and password now work: the import dialog gained username/password fields and the app completes the portal's do_auth step. When a portal refuses access, its own explanation is shown instead of a generic error, saved sessions resume without re-authenticating, and the keep-alive ping follows the portal's cadence. ([#1354](https://github.com/4gray/iptvnator/pull/1354))
- **stalker** — Stalker portals now check the MAC address as you type it and fix hyphens or lowercase for you, with a warning when it sits outside the range most portals accept. Device IDs can optionally be generated from the MAC the way StbEmu does, and a portal that already has a different device ID on file finally says so instead of reporting damaged hardware. ([#1370](https://github.com/4gray/iptvnator/pull/1370), closes [#927](https://github.com/4gray/iptvnator/issues/927), closes [#860](https://github.com/4gray/iptvnator/issues/860))
- **stalker** — Stalker movie and series catalogs now load continuously as you scroll — portal pages append into one seamless list, tall windows fill themselves, and a failed page keeps what's loaded and offers a retry. The Live TV "all channels" grid and portal search follow the same style, and search can page past its first hundred results. Pagination is gone from the app entirely. ([#1395](https://github.com/4gray/iptvnator/pull/1395))
- **stalker** — The Live TV section loads its full channel list up front: search covers every channel instead of only the page you are on, genres show how many channels they hold, and Live TV opens on a grid of all channels. Guide data for the visible rows loads in bulk, so it shows up without playing a channel first. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **stalker** — Stalker setup now accepts hosts or `/c`, discovers the working API endpoint and authentication mode, and rechecks edited connection details. Canceled or failed edits leave saved and active sessions unchanged. Completed edits reject old configuration requests and late responses. Timed-out authentication stays fenced until its transport settles. ([#1391](https://github.com/4gray/iptvnator/pull/1391))
- **tmdb** — Settings → Metadata (TMDB) now shows how many entries the metadata cache holds and how much space they take, with a button to empty it. Clearing costs nothing but the next few lookups — enrichment refetches on demand. ([#1244](https://github.com/4gray/iptvnator/pull/1244))
- **tmdb** — Series pages show whether a show has ended or is still returning, so you know before committing to it. Directors and creators became clickable avatar chips like the cast — they open the person's page, where directing credits now sit alongside acting ones. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **ui** — Live channel rows now stack their action buttons vertically — favorite on top, programme info below — so the extra button costs no horizontal space. The programme-info button is now also available in the Xtream and Stalker channel sidebars, and its slot stays reserved while EPG data loads, so buttons never jump. ([#1341](https://github.com/4gray/iptvnator/pull/1341), closes [#1128](https://github.com/4gray/iptvnator/issues/1128))
- **ui** — On phone-sized screens the categories and filters panel no longer sits stacked above the content — it is now a slide-in drawer, opened from a new button in the header and closed by picking an entry, tapping outside it, or pressing Escape. The content gets the whole screen while browsing. ([#1332](https://github.com/4gray/iptvnator/pull/1332), closes [#1100](https://github.com/4gray/iptvnator/issues/1100))
- **xtream** — Catch-up is available from Favorites and Recent, not just Live TV, so an archived programme is reachable wherever the channel is. The programme currently on air can also be restarted from the beginning. ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#1138](https://github.com/4gray/iptvnator/issues/1138))
- **xtream** — Live channels with provider catch-up now show a small archive badge — in the channel sidebar next to the channel name, on the "all channels" grid cards, and in the favorites and recently-viewed lists (including global favorites). Hovering it shows the catch-up window in days. ([#1341](https://github.com/4gray/iptvnator/pull/1341), closes [#1128](https://github.com/4gray/iptvnator/issues/1128))
- **xtream** — Xtream movie, series, and live catalogs now load continuously as you scroll instead of flipping through pages — more items appear automatically as you near the bottom, and taller windows fill themselves on open. Opening a title and going back returns you to the exact spot in the list. In-category search and the in-portal search results follow the same continuous style. ([#1392](https://github.com/4gray/iptvnator/pull/1392))
- **xtream** — Continue Watching resumes a series where you left it: opening one from the dashboard starts the exact episode at its saved position, and the series page offers "Play episode N" instead of always starting at the first one. Episodes launched in MPV or VLC count towards this too. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **xtream** — The movie sources popover now recognizes more language tags: prefixes with Unicode pipes, brackets or dashes ("EN │ …", "[EN] …", "EN - …"), Cyrillic tags ("РУС | …") and MULTI. It also reads the language off category names ("EN | Netflix"), and a tag welded to a title ("EN|Movie") no longer hides that copy from the other playlists' copies of the same movie. ([#1417](https://github.com/4gray/iptvnator/pull/1417))

### Fixes

- **backup** — Backups carry hidden Xtream categories correctly. An export used to lose which categories you had hidden, and restoring such a backup then hid every category of that kind. ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#1017](https://github.com/4gray/iptvnator/issues/1017))
- **components** — Confirmation dialogs are wider by default, so their action buttons sit side by side instead of wrapping into a vertical stack with longer translated labels. ([#1448](https://github.com/4gray/iptvnator/pull/1448))
- **dashboard** — The dashboard hero now shows the same backdrop as the detail page. Stalker movies and series reuse the artwork saved when you opened them, and the metadata lookup behind the hero uses the release year and original title instead of the bare title — so titles TMDB knows more than once ("Холод") no longer come up empty. ([#1362](https://github.com/4gray/iptvnator/pull/1362))
- **dashboard** — Movies and series you have opened before now show their artwork, rating and genres on the dashboard far more reliably, and seed the recommendations rail. Previously the dashboard searched TMDB by title alone, so common titles like "Inside Out" matched nothing — it now reuses what the detail page already found. ([#1423](https://github.com/4gray/iptvnator/pull/1423))
- **dashboard** — Trending cards, the "Similar" rail and actor filmographies no longer show a title as missing from your library when your playlists hold several versions of it. A catalog with both "Dune 1984" and "Dune 2021" used to keep whichever came first, so the other one lost its link even though you had it. ([#1425](https://github.com/4gray/iptvnator/pull/1425))
- **database** — SQLite diagnostics now record only statement types, preventing playlist credentials and other private values from appearing in trace logs. ([#1315](https://github.com/4gray/iptvnator/pull/1315))
- **deps** — Database workers now use updated SQLite bindings that avoid a crash during worker shutdown. ([#1415](https://github.com/4gray/iptvnator/pull/1415))
- **downloads** — Downloads from portals that cut long connections no longer die with "aborted": the app now reconnects automatically and continues from where the transfer stopped. Resume also works on servers that send no ETag/Last-Modified — the app re-checks a 256 KiB overlap against the saved partial before appending, and only gives up after repeated reconnects make no progress. ([#1446](https://github.com/4gray/iptvnator/pull/1446))
- **downloads** — Xtream movie and episode downloads now keep their provider-compatible identity from the first request through legacy retries after source removal. Recoverable connection drops retain validated partials and show a credential-safe code; Retry resumes only with ETag or Last-Modified, otherwise it safely restarts. ([#1329](https://github.com/4gray/iptvnator/pull/1329), closes [#897](https://github.com/4gray/iptvnator/issues/897), closes [#1289](https://github.com/4gray/iptvnator/issues/1289))
- **electron-backend** — Cancelling a large Xtream import now stops database work even while it is running at full speed, instead of letting the import finish before processing the cancel request. ([#1295](https://github.com/4gray/iptvnator/pull/1295))
- **electron** — The desktop remote-control server now blocks crafted static paths from escaping bundled web files on Windows. ([#1267](https://github.com/4gray/iptvnator/pull/1267))
- **embedded-mpv** — Opening the volume, audio, subtitle, speed or aspect menu in the Embedded MPV player no longer makes the video jump or leave a black bar above the controls: the menus now unfold inside the control bar instead of floating over the video. ([#1339](https://github.com/4gray/iptvnator/pull/1339), closes [#1139](https://github.com/4gray/iptvnator/issues/1139))
- **embedded-mpv** — On Windows and Linux displays scaled above 100%, the Embedded MPV video was drawn toward the top-left corner at a fraction of its size, in windowed and fullscreen mode alike. The video now fills the player area correctly at any display scale and page zoom, with no need for a high-DPI compatibility workaround. ([#1339](https://github.com/4gray/iptvnator/pull/1339), closes [#1139](https://github.com/4gray/iptvnator/issues/1139), closes [#1145](https://github.com/4gray/iptvnator/issues/1145))
- **epg** — A database error while looking up manual EPG channel mappings no longer breaks the request that triggered it. Searching for a channel in the "Map EPG channel" dialog, or saving and removing a mapping, now degrades gracefully instead of failing outright. ([#1291](https://github.com/4gray/iptvnator/pull/1291))
- **epg** — A database error while reading or saving a manual EPG channel mapping no longer surfaces as a failed request. Looking up, saving, deleting, and searching mappings now fall back quietly, so a transient storage hiccup can no longer take down the EPG panel or the "Map EPG channel" dialog. ([#1279](https://github.com/4gray/iptvnator/pull/1279))
- **favorites** — Favorites stop losing changes. The custom drag-and-drop order of an Xtream playlist's own favorites is saved again, and two favorites or history entries added at almost the same moment no longer quietly overwrite each other. ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#1137](https://github.com/4gray/iptvnator/issues/1137))
- **i18n** — Translations across the app are clearer and more consistent in supported languages. ([#1390](https://github.com/4gray/iptvnator/pull/1390))
- **m3u** — When a channel plays in MPV, VLC or the embedded MPV player, the custom User-Agent, Referer and Origin saved on the M3U playlist now reach the player. Per-channel `#EXTVLCOPT` headers still win; the playlist values only fill the gaps. VLC now also sends the Origin value as a real HTTP header, as MPV already did. ([#1397](https://github.com/4gray/iptvnator/pull/1397), closes [#1221](https://github.com/4gray/iptvnator/issues/1221))
- **m3u** — Playlists with very long stream URLs — Pluto TV style lists that carry a session token in every link — import in full again instead of collapsing into a single channel. ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#1189](https://github.com/4gray/iptvnator/issues/1189))
- **matching** — Movies whose name is a short abbreviation — AKA, RRR, IO, VFW, Y2K — are no longer mistaken for a language tag and filed under their release year alone. They now match their own copies in your other playlists, so alternative sources, recommendations and pinned sources land on the right film instead of an unrelated one that happens to share that year. ([#1426](https://github.com/4gray/iptvnator/pull/1426))
- **packaging** — Snap packages now launch correctly with the desktop runtime scripts required by their generated startup command. ([#1406](https://github.com/4gray/iptvnator/pull/1406))
- **playback** — Unavailable streams no longer appear as unsupported codecs. When Video.js exposes a server error such as HTTP 404, the player shows that status; otherwise ambiguous source errors remain unidentified instead of guessing. ([#1314](https://github.com/4gray/iptvnator/pull/1314), closes [#1159](https://github.com/4gray/iptvnator/issues/1159))
- **playback** — The embedded MPV video no longer drifts out of its frame when the layout shifts around it — for example when the channel sidebar or the EPG panel finishes loading after playback has started. The player now notices such moves and snaps the video back into place within half a second. ([#1476](https://github.com/4gray/iptvnator/pull/1476), closes [#1428](https://github.com/4gray/iptvnator/issues/1428))
- **playback** — MPV and VLC recovery actions now stay available, show precise opening, started, playing, and failure feedback, and prevent overlapping launches. The dock keeps Stop available when teardown is still needed and lets terminal errors be dismissed. ([#1388](https://github.com/4gray/iptvnator/pull/1388))
- **playback** — The screen no longer dims or goes to sleep while a built-in player is playing video — including on Linux desktops, where the system idle timer used to ignore the app. Pausing or stopping hands control back to the system immediately, and radio playback deliberately leaves the display free to sleep. Works in both the desktop app and the PWA. ([#1405](https://github.com/4gray/iptvnator/pull/1405), closes [#1095](https://github.com/4gray/iptvnator/issues/1095))
- **playback** — Playback keyboard shortcuts now work with the default player setup: Space/K (play/pause), F (fullscreen), ←/→ (seek 5s in VOD), ↑/↓ (volume), and M (mute) act on the built-in HTML5, Video.js, and ArtPlayer players without turning on shared player controls — matching what the in-app shortcut list already promised. ([#1398](https://github.com/4gray/iptvnator/pull/1398))
- **playback** — Switching the video player — from the command palette or the settings page — now takes effect immediately on an already-playing Xtream or Stalker stream instead of waiting for the player to be reopened. Playback also starts with the saved player right away, without briefly mounting the default engine first. ([#1437](https://github.com/4gray/iptvnator/pull/1437))
- **playback** — MPEG-TS playback is now more reliable on newer Safari versions when streams contain audio timestamp gaps. ([#1412](https://github.com/4gray/iptvnator/pull/1412))
- **playback** — External MPV and the embedded MPV frame-copy engine no longer truncate HTTP headers that contain commas — most notably the Stalker MAG user agent. Strict portals validated that header and rejected live streams with HTTP 400, so channels that only worked in VLC now also play through MPV. Completes the same fix that landed for the native embedded MPV view. ([#1323](https://github.com/4gray/iptvnator/pull/1323), closes [#910](https://github.com/4gray/iptvnator/issues/910))
- **playback** — When playback fails, IPTVnator now ranks useful next steps from the reported error, including another compatible built-in player, MPV/VLC, Retry, or another source. Trying a built-in recommendation affects only the current item and does not change the saved player setting. ([#1374](https://github.com/4gray/iptvnator/pull/1374), closes [#1159](https://github.com/4gray/iptvnator/issues/1159))
- **playback** — Playback recovery now removes old error actions as soon as a new source or player starts, even while Electron prepares stream headers. Stalker series playing inline now picks up refreshed episode names and navigation, and safely disables episode commands if the playing episode disappears. ([#1374](https://github.com/4gray/iptvnator/pull/1374))
- **playback** — DASH playback now resets a failed media buffer before switching variants, avoiding repeated append failures and crashes on affected platforms. ([#1411](https://github.com/4gray/iptvnator/pull/1411))
- **playback** — Playback recovery no longer crosses into a different selected channel, movie, or exact Stalker episode. Switching content while a stream resolves no longer restores stale playback or shows an error from the previous selection. ([#1374](https://github.com/4gray/iptvnator/pull/1374), closes [#1159](https://github.com/4gray/iptvnator/issues/1159))
- **playback** — Stalker streams that require the portal session now play in the built-in players (HTML5, Video.js, ArtPlayer), not only in VLC/MPV: the player's requests carry the portal cookie and token, scoped to that stream and dropped when the player closes or the channel changes. VOD, series and radio get the same headers live TV had — also from Favorites and Recently Viewed. ([#1335](https://github.com/4gray/iptvnator/pull/1335), closes [#849](https://github.com/4gray/iptvnator/issues/849), closes [#910](https://github.com/4gray/iptvnator/issues/910), closes [#732](https://github.com/4gray/iptvnator/issues/732))
- **playback** — HLS failures now use confirmed player evidence such as the failed stage, timeout, and HTTP status. Recoverable retries stay silent, and technical details no longer include raw provider error payloads. ([#1316](https://github.com/4gray/iptvnator/pull/1316))
- **playback** — MPEG-TS playback errors now show exact engine evidence, including HTTP status, without exposing provider response details. Format, codec, truncated-stream, and MediaSource failures now produce more accurate fallback guidance. ([#1327](https://github.com/4gray/iptvnator/pull/1327), closes [#1159](https://github.com/4gray/iptvnator/issues/1159))
- **playback** — Shaka playback errors now use exact engine evidence, including subtitle parsing, preserve external-player fallback when browser prerequisites are missing, keep recoverable retries non-terminal, and omit provider URLs, credentials, and response data from technical details. ([#1318](https://github.com/4gray/iptvnator/pull/1318))
- **playback** — The default web player now reports safer, more accurate streaming errors: confirmed network and encrypted-segment failures keep structured details, while ambiguous Video.js errors remain unknown instead of suggesting the wrong cause. ([#1317](https://github.com/4gray/iptvnator/pull/1317))
- **playback** — The "Show subtitles" setting now works in the built-in players: turning it off hides subtitles a stream switched on by itself, and the preference finally applies on Xtream and Stalker pages too. Previously it only reached the M3U player, and even there Video.js and ArtPlayer ignored it. The player's own subtitle menu still overrides the setting for the current stream. ([#1269](https://github.com/4gray/iptvnator/pull/1269), closes [#1155](https://github.com/4gray/iptvnator/issues/1155))
- **playback** — Video.js now shows its own control bar (play/pause, seek, volume, quality, fullscreen) on Live TV channels. Previously live streams played with no visible controls at all, because switching to a live source rebuilt the video element and the controls never came back. ([#1385](https://github.com/4gray/iptvnator/pull/1385))
- **playlist** — Opening an .m3u/.m3u8 file from the command line or by double-clicking it now actually imports the playlist — previously nothing happened at all. Opening a playlist while IPTVnator is already running works too, and on macOS the file arrives through the system "open with" event. ([#1299](https://github.com/4gray/iptvnator/pull/1299))
- **playlist** — IPTVnator now registers itself with the operating system as a handler for .m3u and .m3u8 files, so Finder, Explorer and Linux file managers offer it in "Open with" and a double-click actually opens the playlist. Installing or updating the app is enough — no manual file-type setup. ([#1301](https://github.com/4gray/iptvnator/pull/1301))
- **playlists** — One unreachable playlist no longer holds up the rest. Refreshes give up after 30 seconds and run a few at a time, so your other playlists still update, and the message on startup names how many actually failed instead of always claiming success. ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#931](https://github.com/4gray/iptvnator/issues/931))
- **portals** — Importing an Xtream backup now restores all preferred VOD sources together. If restoration or cleanup fails, the catalog stays retryable and remains blocked until the parked state is safely consumed, preventing stale replay from overwriting newer choices. ([#1311](https://github.com/4gray/iptvnator/pull/1311))
- **portals** — Greek titles now match no matter which sigma the provider typed. A word-final `ς` and a medial `σ` at the end of a word are treated as the same letter, so finding a film in your other playlists, the "Similar" rail, actor filmographies and TMDB enrichment no longer miss a Greek movie purely because two catalogues spelled its last letter differently. ([#1310](https://github.com/4gray/iptvnator/pull/1310))
- **portals** — In the self-hosted web version, a provider that accepted a connection and then went silent could hang a request until the operating system gave up, with no way to cancel it. Requests now time out on the same schedule as the desktop app, and a host that fails to answer twice is skipped for a short while instead of stalling every following request. ([#1424](https://github.com/4gray/iptvnator/pull/1424))
- **portals** — Going back from a Stalker title you reached with "View in portal" now returns you to exactly where you were — the same favorites or history tab, with the title still open — instead of dropping you on the Live TV tab. ([#1435](https://github.com/4gray/iptvnator/pull/1435))
- **portals** — Refreshing an Xtream source keeps your favorites, watch history, hidden categories and playback positions. Starting the same refresh twice at once — from the header and from the sources page — used to wipe them, because the second run saved an already-emptied catalog over the first run's copy. ([#1431](https://github.com/4gray/iptvnator/pull/1431))
- **pwa** — The self-hosted web backend now gives each provider connection attempt enough time to fall back from an unreachable IPv6 route to working IPv4 — common behind VPN containers like Gluetun — instead of failing with a bare "Bad Gateway". Provider errors now name the underlying network code (for example ETIMEDOUT) in the app and in the container logs. ([#1404](https://github.com/4gray/iptvnator/pull/1404), closes [#1400](https://github.com/4gray/iptvnator/issues/1400))
- **pwa** — Self-hosted web backends started without `CLIENT_URL` now allow the documented `http://localhost:4333` origin instead of the retired public demo URL, so a manual (non-Docker) deployment no longer fails every provider request with a CORS error. ([cb37f62](https://github.com/4gray/iptvnator/commit/cb37f628ed9d63673d365923828ce7a793192459))
- **pwa** — The self-hosted web app now talks to Stalker portals exactly like the desktop app: MAG User-Agent, full STB cookie, serial-number header, and the `JsHttpRequest` marker every real client sends — so portals that worked only in the desktop app now work in the PWA too. Portal credentials (MAC and session token) no longer travel in the portal request URL, keeping them out of server logs. ([#1348](https://github.com/4gray/iptvnator/pull/1348))
- **search** — The search box no longer loses what you are typing when the page updates its address at the same moment — switching a downloads filter and immediately typing used to wipe the term, and fast typing could snap back to an earlier word. ([#1432](https://github.com/4gray/iptvnator/pull/1432))
- **search** — Searching for names that carry punctuation inside them — "A&E", "X-Men", "L'Equipe" — finds them anywhere in a title, including channels the provider prefixes, like "US: A&E". ([#1263](https://github.com/4gray/iptvnator/pull/1263), closes [#1161](https://github.com/4gray/iptvnator/issues/1161))
- **search** — Typing a space in the portal search box and pausing briefly no longer deletes the space — continuing to type "Bein Sports" no longer collapses into "BeinSports". ([#1474](https://github.com/4gray/iptvnator/pull/1474), closes [#1338](https://github.com/4gray/iptvnator/issues/1338))
- **settings** — Launching IPTVnator a second time now brings the running window to the front instead of starting a rival copy that could not save anything — a common reason settings appeared to reset on restart. If saving or loading settings does fail, the app now says so instead of silently showing defaults. ([#1272](https://github.com/4gray/iptvnator/pull/1272), closes [#1156](https://github.com/4gray/iptvnator/issues/1156), closes [#102](https://github.com/4gray/iptvnator/issues/102))
- **settings** — Unsaved settings edits no longer vanish silently when you close the window, quit the app, or reload the page. The desktop app now asks whether to save, discard, or keep editing — the same dialog in-app navigation shows — and only closes once your choice is applied; a failed save keeps the window open. In the browser, the native leave-page warning appears instead. ([#1394](https://github.com/4gray/iptvnator/pull/1394))
- **stalker** — A Stalker portal is no longer re-probed and reclassified because something in front of it — a proxy or firewall, not the portal — answered with a short "Access denied" page. Only the portal's own authorization replies count now. ([#1358](https://github.com/4gray/iptvnator/pull/1358))
- **stalker** — Stalker portals now receive channel commands exactly as a real set-top box sends them: already-encoded parts of a channel's `cmd` are no longer double-encoded, so strict portals and reseller panels that compare the command literally work again. Playing Stalker channels from Favorites or global collections now also handles portals that answer with relative stream paths. ([#1334](https://github.com/4gray/iptvnator/pull/1334))
- **stalker** — Series opened from Favorites, Recent or the dashboard show their current episodes. One saved back when a single episode existed used to keep showing that one episode forever; the list is refreshed from the portal in the background instead. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **stalker** — Stalker portals are no longer classified by their URL shape: importing probes the real API endpoint (`portal.php` vs `server/load.php`) and checks whether the portal actually requires authentication. Canonical Ministra URLs finally load content, `…/c` addresses resolve correctly, and misclassified existing portals repair themselves on first failure — keeping favorites and history. ([#1344](https://github.com/4gray/iptvnator/pull/1344), closes [#850](https://github.com/4gray/iptvnator/issues/850), closes [#686](https://github.com/4gray/iptvnator/issues/686), closes [#755](https://github.com/4gray/iptvnator/issues/755))
- **stalker** — Stalker Live TV now shows the currently airing programme even on portals whose bulk EPG only lists upcoming shows: channel rows fall back to a per-channel short-EPG lookup, and the EPG panel merges "what's on now" into the schedule instead of showing future programmes only. ([#1386](https://github.com/4gray/iptvnator/pull/1386))
- **playback** — Stalker live TV plays again in the embedded MPV player. The MAG250 user agent contains a comma (`KHTML, like Gecko`), which MPV splits in its comma-separated `--http-header-fields` list, truncating `X-User-Agent` so strict portals reject the stream with HTTP 400. Commas and backslashes in header values are now escaped on the Windows/Linux and macOS embedded-MPV paths. ([#1321](https://github.com/4gray/iptvnator/pull/1321))
- **stalker** — Stalker portals whose server redirects to https or to another port no longer lose their session mid-request. Since 0.22 such redirects silently dropped the portal's MAC cookie and auth token, so categories failed to load and streams never reached any player. Downgrade redirects from https to plain http still strip credentials, so a secure session is never sent in cleartext. ([#1322](https://github.com/4gray/iptvnator/pull/1322), closes [#1158](https://github.com/4gray/iptvnator/issues/1158))
- **stalker** — Stalker VOD series now report progress correctly when portals return boolean series flags, keep episode progress separate between shows, and resume positions saved by earlier versions. ([#1315](https://github.com/4gray/iptvnator/pull/1315))
- **stalker** — Stalker channels that the portal serves directly now start without an extra link request to the portal, so they open faster and no longer fail when that request does. Channels the portal does proxy still get their temporary link, and radio stations the portal proxies now get one too instead of playing a URL the portal never meant to serve. ([#1364](https://github.com/4gray/iptvnator/pull/1364))
- **tmdb** — Movies whose provider ships a dead or wrong TMDB id are enriched again. The id is weighed against the title and release year: a dead one falls back to the title search, a stale one that clearly points at another film loses to it, and a working id is no longer thrown away just because the provider spells the title differently. ([#1239](https://github.com/4gray/iptvnator/pull/1239))
- **tmdb** — Series detail pages now list the cast of the whole show instead of only its newest season, so actors who left partway through stop disappearing from long-running shows — while people who joined for the current season still show up. ([#1242](https://github.com/4gray/iptvnator/pull/1242))
- **tmdb** — Titles that providers dress up with language or quality tags — "|ALB| Fallout", "4K-DE - The Pitt (2025)", "Breaking Bad-eng" — now match against TMDB, so they get artwork, plot and cast like the rest of the catalog. Shows split into one entry per season also pull the season that entry really contains. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **ui** — IPTVnator is usable on a phone again. The navigation bar no longer sits off screen, category and channel lists take the full width instead of squeezing the content into a sliver, the video keeps a usable share of the screen, and the M3U channel list can be reopened after hiding it. ([#1326](https://github.com/4gray/iptvnator/pull/1326), closes [#1100](https://github.com/4gray/iptvnator/issues/1100))
- **ui** — Narrow EPG channel rows now keep the current programme, progress, and enabled channel actions visible instead of dropping useful context. ([#1312](https://github.com/4gray/iptvnator/pull/1312))
- **window-controls** — On Windows, the minimize, maximize and close buttons disappeared for good after leaving fullscreen video playback — the only way to get them back was to restart the app. They now reappear as soon as you exit fullscreen, and the maximize button no longer gets stuck on the wrong icon afterwards. ([#1178](https://github.com/4gray/iptvnator/pull/1178))
- **workspace** — The playlist dropdown in the header shows a "Playlist info" entry for the active playlist again, next to "Account info" and "Add playlist" — it had disappeared when playlist actions moved into the per-row menu. ([#1328](https://github.com/4gray/iptvnator/pull/1328))
- **workspace** — The playlist sync overlay no longer shows a bare "Syncing playlist" card when an Xtream playlist is loaded from the local library. Reading the saved catalog from this device now reports its own phase, so the overlay always shows a source badge and explains what is happening — remote fetch or local read. ([#1345](https://github.com/4gray/iptvnator/pull/1345))
- **xtream** — Portals sitting behind Cloudflare or a similar firewall connect again. Those setups answered the app with a challenge page instead of data, so "Test connection" failed on portals that worked fine in every other player; requests now identify themselves the way an ordinary IPTV player does. ([#1263](https://github.com/4gray/iptvnator/pull/1263))
- **xtream** — Series pages no longer show a raw image link under the season tabs when the provider fills the season description with a cover URL. URL-only descriptions are dropped, and with TMDB metadata enabled the missing season description is filled from TMDB instead. ([#1382](https://github.com/4gray/iptvnator/pull/1382))
- **xtream** — Xtream movies remain playable when a portal omits extended VOD metadata, using catalog stream details to build the playback URL. ([#1303](https://github.com/4gray/iptvnator/pull/1303))

### Performance

- **m3u** — Importing large M3U playlists is faster because IPTVnator no longer rewrites the entire playlist when loading saved favorites. ([#1232](https://github.com/4gray/iptvnator/pull/1232))
- **m3u** — Cancelling a large M3U refresh now stops its background worker before parsed channels can be copied or saved, keeping the interface responsive and leaving the existing playlist unchanged. ([#1268](https://github.com/4gray/iptvnator/pull/1268))
- **portals** — Unreachable Xtream and Stalker portals no longer cost a 30-second wait per request. After a host fails to answer twice, further requests to it fail immediately for 30 seconds, so browsing a dead portal stops filling the screen with long spinners. Retrying, testing the connection, or editing the portal address contacts it again right away. ([#1421](https://github.com/4gray/iptvnator/pull/1421))
- **stalker** — Detail pages for anything that is not a series — a movie, a live channel, a VOD item that only looks like a series — no longer fire an episode-list request before they can show anything, so they open faster on every route in, from browsing and search to Favorites, Recent and the dashboard. ([#1263](https://github.com/4gray/iptvnator/pull/1263))

<details>
<summary>Internal changes</summary>

- **build** — Shared UI stylesheets are now part of the build cache key. Edits to them previously produced a cache hit, so a style fix could be silently missing from a rebuilt app until the cache was bypassed. A CI check now fails any stylesheet import that escapes its build's inputs. ([#1360](https://github.com/4gray/iptvnator/pull/1360))
- **build** — Electron development serve no longer crashes while Vite transforms a large lazy chunk. The pinned Vite release now carries a backtracking-safe transform filter fix, with a regression check guarding dependency updates. ([#1379](https://github.com/4gray/iptvnator/pull/1379))
- **deps** — Coordinated security dependency sweep closing all open Dependabot alerts: the two runtime-scope advisories (js-yaml YAML-parsing DoS reached through electron-updater, fast-uri host confusion reached through electron-conf) plus the dev-only clusters — Astro 5→7 for the website, hono, undici, postcss and a dozen other transitive bumps via pnpm overrides. ([#1475](https://github.com/4gray/iptvnator/pull/1475))
- **deps** — The web backend now uses the current structured XMLTV parser output, covered by a route-level contract test for future PWA EPG support. ([#1413](https://github.com/4gray/iptvnator/pull/1413))
- **deps** — Updated ngx-indexed-db (the PWA's IndexedDB storage library) from 21 to 22. No behavior change. ([#1472](https://github.com/4gray/iptvnator/pull/1472))
- **deps** — Updated 43 dependencies, including the HTTP client behind every playlist and portal request — that one closes seven advisories that affect the shipped app, among them a proxy-credential leak on redirects. Also refreshes the ArtPlayer, hls.js, Video.js and Shaka player engines. No behaviour change intended. ([#1270](https://github.com/4gray/iptvnator/pull/1270))
- **deps** — Patched five vulnerable transitive dependencies that ship with the app — including the YAML parser `electron-updater` uses to read update manifests, and the HTTP form encoder behind portal requests. No behaviour change. ([#1258](https://github.com/4gray/iptvnator/pull/1258))
- **portals** — Failed Stalker portal requests now log a compact, credential-free summary (action, host, error code, HTTP status) in the desktop backend instead of dumping the full multi-page network error object, matching the existing Xtream request logging. ([#1418](https://github.com/4gray/iptvnator/pull/1418))

</details>

# [0.12.0](https://github.com/4gray/iptvnator/compare/v0.11.1...v0.12.0) (2023-03-11)


### Important change

The storage location of playlists has been changed, now everything is stored in IndexedDB. So after the update you will see a panel offering to migrate playlists.

### Bug Fixes

* macos related window management improvements ([b336680](https://github.com/4gray/iptvnator/commit/**b336680ec93b6c2a78af08bf1847f6e133895719**))
* set epgSource as not required field ([049ed6b](https://github.com/4gray/iptvnator/commit/049ed6be519df602fd8eb5071fb17efe1a850000)), closes [#175](https://github.com/4gray/iptvnator/issues/175)


### Features

* add cmd+q hotkey to close the app (macOS) ([f3e00e7](https://github.com/4gray/iptvnator/commit/f3e00e78aa65b64d058c27b616b0d11d1a374015)), closes [#181](https://github.com/4gray/iptvnator/issues/181)
* add dockerfile and docker-compose ([4b97e3d](https://github.com/4gray/iptvnator/commit/4b97e3d4b3b84a57c5c09cc25c0c362de341e2ba))
* add italian language ([3e3f18c](https://github.com/4gray/iptvnator/commit/3e3f18cabf3784bcfee17e54771ca0a5dbcbbf33))
* draggable channels in favorites list ([ba41c8d](https://github.com/4gray/iptvnator/commit/ba41c8dae5e82bd1f39fb9a6cd8518e25dcdb894))
* export playlist as m3u ([7e4d6b1](https://github.com/4gray/iptvnator/commit/7e4d6b171fa87ffb7084344a10d653dd2cb30ea2))
* persist window size ([2ce60e0](https://github.com/4gray/iptvnator/commit/2ce60e0a205dd8034626f35bfea1632fcac56529)), closes [#205](https://github.com/4gray/iptvnator/issues/205)
* **pwa:** load a m3u playlist as a URL parameter [#176](https://github.com/4gray/iptvnator/issues/176) ([344bd75](https://github.com/4gray/iptvnator/commit/344bd75c876ff3d26e5721e64e7b35cf7547950a))



## [0.11.1](https://github.com/4gray/iptvnator/compare/v0.11.0...v0.11.1) (2022-10-01)


### Bug Fixes

* allow file:// protocol for epg source ([c4e1076](https://github.com/4gray/iptvnator/commit/c4e107681e55ac168a86b57cf0c6bfd5a2b35c5c))
* disable service worker in electron app ([df4e99a](https://github.com/4gray/iptvnator/commit/df4e99a4ae7186322eddcab8b6a81a04bd4c2e1a))
* red screen in PIP window ([9756a76](https://github.com/4gray/iptvnator/commit/9756a76a90c05c008cd84c690c82b04c7ec56c87))
* service worker injection ([ba3dd88](https://github.com/4gray/iptvnator/commit/ba3dd88dde1129ac21ec6056b81f7ff8b569f5d6))


### Reverts

* Revert "Update release.yml" ([5ac1992](https://github.com/4gray/iptvnator/commit/5ac199281d0fa24998cf01dff148316f7684e46a))



# [0.11.0](https://github.com/4gray/iptvnator/compare/v0.10.0...v0.11.0) (2022-09-11)


### Bug Fixes

* set default value for video player ([ab1d0bf](https://github.com/4gray/iptvnator/commit/ab1d0bfec85dd8a43606c02a215c6654b809bb15))
* show notification after playlist refresh (PWA) ([b18e537](https://github.com/4gray/iptvnator/commit/b18e537ccb25c49002577a7aedd810c81eb981ea))


### Features

* check for available updates in PWA ([17b265f](https://github.com/4gray/iptvnator/commit/17b265f5a6bc4cae5c66532ccda3af580b52779c))
* implement multi epg view ([b4db751](https://github.com/4gray/iptvnator/commit/b4db751fb66353700dbc9e2285232da28ee655cb))
* import playlist as text ([6676fa0](https://github.com/4gray/iptvnator/commit/6676fa0a4267a5cb56697b47f24954581873f3e1))
* support multiple epg sources ([f8c6874](https://github.com/4gray/iptvnator/commit/f8c6874ad3734ef74e5de25e83626c7e8e77c55a))



# [0.10.0](https://github.com/4gray/iptvnator/compare/v0.9.0...v0.10.0) (2022-04-24)


### Bug Fixes

* capitalize app name [#117](https://github.com/4gray/iptvnator/issues/117) ([36d3eaa](https://github.com/4gray/iptvnator/commit/36d3eaa54d546de64a9522583772cf411a2866c4))
* epg function to compare channel ids ([c7de39e](https://github.com/4gray/iptvnator/commit/c7de39e7c4fa46d9d09adb34a88a060fa9570ea6))


### Features

* add context menu with default actions ([44e76e0](https://github.com/4gray/iptvnator/commit/44e76e0e35eccc085c9b35ddd3a112b6c1aa8e09)), closes [#96](https://github.com/4gray/iptvnator/issues/96)
* add option to change aspect ratio ([b8a3f76](https://github.com/4gray/iptvnator/commit/b8a3f76c40f44416eb69b7ab0d99bf6ad3b5307b)), closes [#80](https://github.com/4gray/iptvnator/issues/80)
* add option to select stream resolution ([c23fe3a](https://github.com/4gray/iptvnator/commit/c23fe3a923ff5b60930f9968ec9cfb611b552858)), closes [#93](https://github.com/4gray/iptvnator/issues/93)
* add pwa support ([5a5085d](https://github.com/4gray/iptvnator/commit/5a5085dcf7e7ba956c02db539160bb06ebce5e80))
* auto-detect if OS is in dark mode ([ad26588](https://github.com/4gray/iptvnator/commit/ad265884e6976ad4ddc636434bf97bc3e02c7613))
* generate global playlist with all favorites ([764201a](https://github.com/4gray/iptvnator/commit/764201a0afa03b0ed3c075e3c3cfcf6fba5c105a)), closes [#97](https://github.com/4gray/iptvnator/issues/97)
* integrate french localization ([ab75a2f](https://github.com/4gray/iptvnator/commit/ab75a2f83752ccebd07ca0dd13e9ded1e58e0efc))
* **pwa:** auto-generate playlist with global favorites ([98ff7f4](https://github.com/4gray/iptvnator/commit/98ff7f4fa4576e00d3de0afd05395f673622ddd8))
* switch playlists from the sidebar ([0bc71d4](https://github.com/4gray/iptvnator/commit/0bc71d47911c9b87cbe92f20f7d024c0027349e1))



# [0.9.0](https://github.com/4gray/iptvnator/compare/v0.8.0...v0.9.0) (2021-10-14)


### Bug Fixes

* search feature should not affect favorites list ([ef52f77](https://github.com/4gray/iptvnator/commit/ef52f77c117c644c2173d4b82783028a19f25011)), closes [#71](https://github.com/4gray/iptvnator/issues/71)


### Features

* add chinese translation ([a497f05](https://github.com/4gray/iptvnator/commit/a497f0570175618d7053b53fd47aa907e6361f17))
* global subtitle display setting ([4d2e175](https://github.com/4gray/iptvnator/commit/4d2e17565d247c2a6bc9ae3d23ab37ff52033478))
* rearrange the display order of playlists ([757c739](https://github.com/4gray/iptvnator/commit/757c739d92d0a646f1927a4c3f2d3eb8425876df)), closes [#77](https://github.com/4gray/iptvnator/issues/77)



# [0.8.0](https://github.com/4gray/iptvnator/compare/v0.7.0...v0.8.0) (2021-07-17)


### Features

* add info popup with epg info for active channel ([0eecfd1](https://github.com/4gray/iptvnator/commit/0eecfd1163a36019a7b600290fe5f01ee3bb9677)), closes [#51](https://github.com/4gray/iptvnator/issues/51)
* add support of specific user-agent and referer on channel level ([a55f741](https://github.com/4gray/iptvnator/commit/a55f741a320db430987352289fd7847e050dcafd)), closes [#57](https://github.com/4gray/iptvnator/issues/57)



# [0.7.0](https://github.com/4gray/iptvnator/compare/v0.6.0...v0.7.0) (2021-05-24)


### Bug Fixes

* promise issue after channel switch [#29](https://github.com/4gray/iptvnator/issues/29) ([d1f194a](https://github.com/4gray/iptvnator/commit/d1f194a25e231fd39f73aae8da7fccf60e7d4826))


### Features

* auto-refresh playlists on app startup ([e8ab576](https://github.com/4gray/iptvnator/commit/e8ab576d8b797a39eb1206e80f19e04abe88bdb4))
* refresh playlist from file system or imported url ([57cf247](https://github.com/4gray/iptvnator/commit/57cf2477d9f3d423eb4ebbd983488b4ade275411))
* support of timeshift and catchup attributes in playlists ([ced16a8](https://github.com/4gray/iptvnator/commit/ced16a88b25c9cb139d3a70ed1194a977cfb07f1))



# [0.6.0](https://github.com/4gray/iptvnator/compare/v0.5.0...v0.6.0) (2021-04-10)


### Bug Fixes

* quit application via window close icon ([24d5584](https://github.com/4gray/iptvnator/commit/24d558470251d479b611a22bfa7f1b7ba0c70a45)), closes [#33](https://github.com/4gray/iptvnator/issues/33)


### Features

* add "what is new" dialog ([cc375a4](https://github.com/4gray/iptvnator/commit/cc375a4d4e068ec6cd23deeb83135fe8b773e517))
* add dark theme ([0cf010a](https://github.com/4gray/iptvnator/commit/0cf010aba31b9e7b8a3344787b7c18bb67405ab7))
* add dialog with detailed epg description ([96e93c5](https://github.com/4gray/iptvnator/commit/96e93c5b0cf1b8d9e703d93c66a1ad552ab44ed8))
* set custom user agent for a playlist ([a8167c4](https://github.com/4gray/iptvnator/commit/a8167c4b2ae625f9714c8bbe5cd6ffa3fcfa0140)), closes [#26](https://github.com/4gray/iptvnator/issues/26)
* show channel logos in the list ([41998ff](https://github.com/4gray/iptvnator/commit/41998ff7a0800368ef64ba184e4bab1b02f509c0)), closes [#28](https://github.com/4gray/iptvnator/issues/28)



# [0.5.0](https://github.com/4gray/iptvnator/compare/v0.4.0...v0.5.0) (2021-02-28)


### Bug Fixes

* less strict url validation of playlist URL ([4f366d9](https://github.com/4gray/iptvnator/commit/4f366d91fd5664787b2258f30a25cb0d3d58b30e)), closes [#22](https://github.com/4gray/iptvnator/issues/22)
* macOS corrupt icon fix, closes [#21](https://github.com/4gray/iptvnator/issues/21) ([955bb27](https://github.com/4gray/iptvnator/commit/955bb27eec4267a954246415fa1234dd4cd2b08c))


### Features

* add dialog about playlist details ([9f951fa](https://github.com/4gray/iptvnator/commit/9f951fa0174e4548c57f7a5392d4d74587ac2023))
* add german language (i18n) ([7888e85](https://github.com/4gray/iptvnator/commit/7888e85ff106176fff3951ec9e9a056e787d28e5))
* add internationalization ([0f8ca2a](https://github.com/4gray/iptvnator/commit/0f8ca2ab1a618dfc3e273ddadfdb51c251912642))
* add russian language (i18n) ([a93af69](https://github.com/4gray/iptvnator/commit/a93af690eea075092ae9a987531af01cd3d9a415))



# [0.4.0](https://github.com/4gray/iptvnator/compare/v0.3.0...v0.4.0) (2021-02-11)


### Bug Fixes

* default html5 player initialization fix ([4a6b976](https://github.com/4gray/iptvnator/commit/4a6b9761902fb694677980874ad3dc4a985e4c90))


### Features

* add `ctrl+f` as hotkey to focus search field ([cad162d](https://github.com/4gray/iptvnator/commit/cad162dc6700a9543571ef051b24d123d41fe9f9))
* add epg worker with new ipc commands ([418566f](https://github.com/4gray/iptvnator/commit/418566f6317960e83edff117a036b54df2eac07b))
* add moment.js based date pipe ([4881ba8](https://github.com/4gray/iptvnator/commit/4881ba8fe073fd425942773e04bbc98bb7d02aaa))
* check for available update ([68ccabb](https://github.com/4gray/iptvnator/commit/68ccabbcb110295aa46a88b1c6c70d057ffaef66))
* epg integration ([2e861b6](https://github.com/4gray/iptvnator/commit/2e861b6a1f2c0744bc1eaae632a79087d1721f41))
* **epg:** epg program list with date navigation ([fdbe02b](https://github.com/4gray/iptvnator/commit/fdbe02b47e400cdad0c6e0294579150590ac5c14))
* favorite channels list ([f02bbe3](https://github.com/4gray/iptvnator/commit/f02bbe39a66a12fd1d3b12863aa2b32048b7691f))
* integrate epg feature ([e896af0](https://github.com/4gray/iptvnator/commit/e896af037303990c95d95efac7296365e8c714ee))
* integrate epg worker & refactor app menu ([3b97d74](https://github.com/4gray/iptvnator/commit/3b97d74e0b39b20d62f4b2911fe0af1a7c70891b))
* sort playlists by import date ([d967b12](https://github.com/4gray/iptvnator/commit/d967b121008075751f47bbd4898894571ef38152))
* validation of playlist url ([da2fe5e](https://github.com/4gray/iptvnator/commit/da2fe5e6bfdf09b1feaf7aa4db6240f962555870))


### Performance Improvements

* destroy hls instance after view change ([2e3681c](https://github.com/4gray/iptvnator/commit/2e3681c36edb9e95509d510ab445ab3d95bb4328))



# [0.2.0](https://github.com/4gray/iptvnator/compare/v0.1.0...v0.2.0) (2020-09-27)


### Features

* add new video.js based player ([1e852e3](https://github.com/4gray/iptvnator/commit/1e852e389931e18ccfaf78f21c86df5dfe81ad6d))
* add settings page ([1a44ecd](https://github.com/4gray/iptvnator/commit/1a44ecd995d212e9597c44353fa049e4f07f0ab7))
* video player configuration in app settings ([05c0c25](https://github.com/4gray/iptvnator/commit/05c0c251cf92ad17788628f5c8d8d8107e935d94))



# [0.1.0](https://github.com/4gray/iptvnator/compare/v0.0.2...v0.1.0) (2020-09-12)


### Bug Fixes

* playlist upload for mac os [#6](https://github.com/4gray/iptvnator/issues/6) ([78ca56f](https://github.com/4gray/iptvnator/commit/78ca56f2b64ca61d7acdce0038d1210e99b07ffc))


### Features

* add new application icon ([0ce0b1f](https://github.com/4gray/iptvnator/commit/0ce0b1f1b5222470c79e666f6be92f507dc2f68d))
* open playlist from file system ([861e480](https://github.com/4gray/iptvnator/commit/861e480b7076fe0e02f96908f4f30ac626722a9a))



## [0.0.2](https://github.com/4gray/iptvnator/compare/v0.0.1...v0.0.2) (2020-09-06)


### Bug Fixes

* define path to userData folder as db store ([8e8c107](https://github.com/4gray/iptvnator/commit/8e8c107ca78d30bc6e90c6894fc021b1ee83d5ea))
* enable copy-paste hotkeys for mac os ([4357c17](https://github.com/4gray/iptvnator/commit/4357c172932231d50c33ee8bc7decfb5a73d9419))



## [0.0.1](https://github.com/4gray/iptvnator/compare/2f1701a3db04beb2fc6aca1e3a05f04c0a04b8af...v0.0.1) (2020-09-05)


### Bug Fixes

* full screen permissions ([fff2aaa](https://github.com/4gray/iptvnator/commit/fff2aaa5416cb29b12c60ff0cbe615e409689808))
* full screen permissions ([f0d0fb1](https://github.com/4gray/iptvnator/commit/f0d0fb1c31651106ae5a2e1e1920b0d6efdfb489))
* start_url fix in manifest file ([e05b7eb](https://github.com/4gray/iptvnator/commit/e05b7ebdfe58fe8b4bb8a169eaa8c0ab62947a32))
* start_url fix in manifest file ([3929655](https://github.com/4gray/iptvnator/commit/392965595581b38229975475562c839e30146920))
* update paths to make app installable ([fd9fc53](https://github.com/4gray/iptvnator/commit/fd9fc5360692030b4ce70eb9cdc44b79239a3fa8))
* update paths to make app installable ([4b7d1b5](https://github.com/4gray/iptvnator/commit/4b7d1b561ca04a8c0ed32a0b6a4ce48e695b310f))


### Features

* add channel search function ([d1b9461](https://github.com/4gray/iptvnator/commit/d1b94615f0d1a420d320babfc3e866dd2520cf72))
* add channel search function ([7a039af](https://github.com/4gray/iptvnator/commit/7a039af3f1e0619ce7a97622668705698380609a))
* add favorites and tab based navigation ([8d333d9](https://github.com/4gray/iptvnator/commit/8d333d95203ec4344f44df0678c70d6840ae1bb0))
* add favorites and tab based navigation ([c6e3e1f](https://github.com/4gray/iptvnator/commit/c6e3e1f02550b83914e284b95943bc05a53ad509))
* add icon, about dialog and menu ([bcf49b8](https://github.com/4gray/iptvnator/commit/bcf49b84c7626c3e87bbdab8ad382df4546f42e9))
* change sidebar mode ([22f2bc1](https://github.com/4gray/iptvnator/commit/22f2bc1df9a588d38e507c1a2b6a5b0a5aadd830))
* change sidebar mode ([ca9f7a2](https://github.com/4gray/iptvnator/commit/ca9f7a254b2551592cc543698b25d622bc262df6))
* electron based app ([0feb657](https://github.com/4gray/iptvnator/commit/0feb65786ab3caf7775195cc266a2789eb3093ed))
* electron based app ([998e7e9](https://github.com/4gray/iptvnator/commit/998e7e92557aff5cf86bd362abdde051275797b0))
* implement channel groups view ([20e0a40](https://github.com/4gray/iptvnator/commit/20e0a4019c6a3db09fa54a3118c67eb348787a18))
* implement channel groups view ([773e1ed](https://github.com/4gray/iptvnator/commit/773e1edf63df735d517fd11dda6dfd6b3181258f))
* initial commit ([79332aa](https://github.com/4gray/iptvnator/commit/79332aa6de5dd2a10fad187e809057e2cbac4abd))
* initial commit ([2f1701a](https://github.com/4gray/iptvnator/commit/2f1701a3db04beb2fc6aca1e3a05f04c0a04b8af))
* list with recent playlists ([1735026](https://github.com/4gray/iptvnator/commit/1735026c201591c4192317f3a5371c8548f8fa1c))
* list with recent playlists ([8ee96ee](https://github.com/4gray/iptvnator/commit/8ee96eeebe0ca422d7bc183296f896c49e827b19))



