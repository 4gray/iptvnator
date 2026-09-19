# Release Pipeline

How a release is assembled, from the note an author writes during an ordinary
PR to the draft GitHub release a human publishes.

The agent-facing entry points are the `release-notes` skill (writing notes) and
the `release-cut` skill (running a release). This document is the contract they
reference: the asset set, the ordering constraints, and the reasons behind
them. The skills stay short on purpose; the detail lives here.

## Two phases

**During ordinary PRs** every user-visible change adds one
`.changes/<area>-<slug>.md` note, written while the context is fresh. CI's
"Release note gate" enforces it. Format and field table: `.changes/README.md`.

**At release time** `tools/release/build-release-notes.mjs` fans those notes
out into every surface, then deletes them. Nothing derives the version — it is
chosen deliberately by bumping `package.json`.

## Surfaces built from one set of notes

| Surface | Command | Writes |
| --- | --- | --- |
| `CHANGELOG.md` section | `release:notes:changelog` | the file |
| Website blog scaffold | `release:notes:blog` | `apps/website/src/content/blog/<vX-Y>-release-notes.mdx` |
| GitHub release body | (tag build) | via `extract-changelog-section.mjs --public` |
| Telegram announcement | `release:notes:telegram` | stdout |
| Reddit announcement | `release:notes:reddit` | stdout |
| Highlight cards | `release:cards:generate` | `dist/release-highlight-cards/v<version>/` |
| Screenshots | `release:screenshots` | `apps/website/public/blog/<vX-Y>/screenshots/` |

Run the two stdout commands as `pnpm --silent run …` whenever the output is
redirected to a file or a clipboard. Without it pnpm prints its lifecycle
banner (`> iptvnator@0.23.0 release:notes:telegram …`) to the same stdout, and
the saved post starts with two lines of build noise.

### The ordering constraint that matters

`build-release-notes.mjs --consume` is the destructive boundary: it deletes the
note files. The `CHANGELOG.md` keeps every entry's text, but **`highlight:`
lives only in the note files** and is not recoverable afterwards. Every surface
that reads it — both announcements and the cards — must therefore run before
`--consume`. The cards additionally need `release:screenshots` to have already
published its frames, since they composite them.

## `highlight:` — what leads a release

An optional note field naming one of the release's two or three headline
changes. It is rejected on `type: internal`, and capped at **60 characters** to
keep it headline-sized — roughly what the hero card fits on one line.

The cap is an authoring guideline, not a rendering guarantee: character count
is not width. Card text wraps by *estimated rendered width*
(`estimateTextWidth`), because 34 `W` at font-size 52 measures ~1948px where
1072px are available — a character-capped line still ran off the canvas.

The SVG names `DM Sans`, but nothing guarantees it is installed: every host
resolves the fallback chain differently, and the same line measures 0.389 em
per `r` here against about 0.49 em elsewhere. No estimate can be both tight
and correct across environments, so the factors sit well above the widest
observation — locally the model over-estimates every sample by at least 1.25×.

That estimate is deliberately **inverted**: narrow characters are enumerated
and everything else is assumed wide. Enumerating the wide ones instead cannot
converge — successive review passes each found another under-estimated glyph
(`W`, then CJK and emoji, then the `ae` ligature) — and a glyph the list misses
crops the card while every unit test still passes. With the wide default the
estimate can only run high, and running high costs an early line break nobody
sees. `tools/release/highlight-cards.test.mjs` renders each sample through sharp and asserts
the estimate never falls below the measured ink width, which is the guard
against that whole class of bug.

Text that cannot fit even after wrapping is ellipsized, and each emitted line
carries an SVG `textLength` clamp when the estimate still says it would
overflow.

Highlights drive three behaviors:

- **Telegram** leads with them and folds everything else into a "…plus N more"
  counter. A `type: breaking` note is never folded, highlighted or not:
  announcing a breaking change as "fixes and improvements" is worse than a
  longer post. If the breaking changes alone cannot fit the 4096-character
  limit, the render fails with an actionable error rather than dropping one.
- **Reddit** gives each one an `## Highlights` subsection, with the remaining
  changes grouped below. Its suggested title names as many highlights as
  Reddit's separate 300-character title cap allows and counts the rest — five
  highlights at the validated 60-character maximum already overshoot it while
  the body stays nowhere near its own limit. The body is bounded the same way
  at Reddit's 40,000-character post limit — this repository's accumulated notes already render ~37,000 —
  dropping from the tail of the grouped list, which is ordered breaking →
  feature → fix → perf so the least consequential go first. A breaking change
  is never dropped there either.
- **The blog scaffold** gives each highlight a row in the opening "What
  changed" table and its own `##` section ahead of everything else, instead of
  emitting `TODO headline (<area>)`. Shape below.

Prose fields keep `#`. `parseFrontmatterLine` strips trailing `# comment` text
only from closed-vocabulary fields (`type`, `area`, `issues`, `screenshot`),
whose values can never contain one — `highlight: Sources #N chip` is a headline.

### Internal-only releases

A release whose notes are all `type: internal` is a legal shape: the authored
GitHub body is empty and GitHub's generated commit list carries the detail.
Both announcement formats then print an explanation on stderr, leave stdout
empty, and exit 0 — the same shape `extract-changelog-section.mjs --public`
already uses for its empty public body.

## Blog scaffold shape

`renderBlogScaffold` (`tools/release/release-notes-blog.mjs`) emits the shape
the published posts end up in, so the editor starts from the form rather than
from the inventory — the v0.23 post shipped as the raw type-grouped list with
area prefixes and had to be restructured after publication. In order:
narrative intro (TODO) → `ReleaseMeta` → `## What changed` (a `ChangeTable`
with one row per highlight; the theme is the default area label, the impact a
TODO) → the "About the screenshots" alert when any note names a screenshot →
one `##` section per highlight or screenshot note, with a `StatusPill`
matching the note type → `## Breaking changes` → the remaining features folded
into themed `##` sections → `## Performance` → `## Everything else`, holding
every remaining fix under a `Spoiler` grouped by theme → the before-updating
alert → `## Thanks` → `## Download` link cards (release tag, full notes, the
compare link when a previous version is known, all releases).

Themes come from `BLOG_THEMES`: a conventional-commit `area` says nothing to a
reader ("matching", "window-controls", "electron-backend"), so notes fold into
reader-facing headings ("Stalker portals", "Live TV, EPG and M3U"). An unmapped
area lands in "Other changes" rather than failing; add it to the map when it
recurs. Two defaults are deliberately dumb: every non-highlighted fix goes into
the spoiler, and every bullet keeps its full note body. Promoting the fixes
users will notice, compressing bullets to one line and writing the bold
lead-ins is the editorial pass, and the scaffold marks where with `TODO`. Only
the components the post actually uses are imported, so an MDX build never
fails on an unused import.

## Highlight cards

`tools/release/highlight-cards.mjs` plans and lays out;
`tools/release/generate-highlight-cards.mjs` renders through sharp. Output is 1200×630 (Open Graph), matching the website
palette in `apps/website/tailwind.config.mjs`.

- One card per highlight, plus a release hero card written as both `hero.png`
  and the `hero.jpg` the blog scaffold's frontmatter references.
- A highlight naming a `screenshot:` gets a framed screenshot strip along the
  bottom; one without gets a typographic layout instead. The frame is opaque
  and painted after the text, so the body's line budget is **derived from the
  space left above it**, never assumed — a fixed count sliced the last line in
  half whenever the headline wrapped to two lines.
- Card filenames come from the note filename, never the screenshot slug: two
  highlights may legitimately share one manifest shot, and naming cards after
  it made the second overwrite the first.

Screenshots come only from the capture script running against the mock servers.
Never publish one taken from a real playlist or account — streams, logos and
metadata are copyrighted, and credentials must never reach a published image.

The same script also produces the evergreen screenshots of the website guides.
Manifest shots that carry `"group": "guides"` are skipped by a release run and
captured only with `pnpm release:screenshots --group guides`, which publishes
into `apps/website/public/blog/guides/screenshots/` instead of a release folder
(`outputDirectoryFor` in `screenshot-guards.mjs`). Guide shots go through every
guard a release shot does; the add-playlist dialog shots fill the form with the
mock's fictional `marketing` credentials and use a labeled hand-out for the
Auto-detect method rather than a `get.php?username=…` link, because G4 rejects
any URL carrying query credentials. Shots that walk into a Stalker portal
(`open-stalker-live`) make the run start the stalker-mock-server on port 3210
and seed its `marketing-demo` portal as a third source, which is why they are
never part of a release run. That scenario's MAC, `00:1A:79:00:00:07`, is the
one MAC-shaped string G4 accepts (`FICTIONAL_STALKER_MAC`); every other MAC
still fails the frame. The scenario's live channels and logos come from
`@iptvnator/shared/marketing-fixtures`, served by the mock itself, so no
third-party image is ever requested.

Output lands in `dist/release-highlight-cards/v<version>/`, outside version
control — keyed by the exact version, because 0.24.0 and 0.24.1 share a blog
post but not a card set. A run first removes the cards a previous run left in
that directory (only files matching what this tool writes), so a renamed or
dropped highlight cannot leave a stale image waiting to be published. Copying a
card into the website tree is a deliberate manual act.

A release with no `highlight:` notes is not an error: the hero card is still
rendered and the run exits 0. An internal-only release has nothing public to
put on a card and exits 0, first clearing any cards an earlier run of the same
version left behind. An **empty** `.changes/` directory is a different thing
and does fail: it almost always means this step ran after `--consume`, and
reporting that as "internal-only" would hide the one ordering mistake the
pipeline is built to prevent.

## Draft verification

The `v*` tag build creates a **draft** GitHub release.
`pnpm run release:verify:draft` (`tools/release/verify-draft-release.mjs`) is
the gate that runs before a human publishes it. It is strictly read-only: it
never publishes, edits or deletes.

1. **Find the run.** `gh run list` reports what is indexed *right now* — its
   `--limit` caps how many runs come back, it does not wait for one to appear,
   and a tag pushed seconds ago routinely is not indexed yet. The verifier
   polls (10 attempts, 6 s apart) before concluding the tag was never pushed.
2. **Wait for it.** An in-progress run is streamed through
   `gh run watch --exit-status`. A completed run with a non-success conclusion
   fails immediately. A missing `gh` binary and an interrupted watch are
   reported as themselves, not as a build failure — `spawnSync` surfaces both
   as `status: null`.
3. **Check the release.** Draft status, the authored body, and the complete
   asset set below.

The authored-body check compares the release body against the **local
`CHANGELOG.md` section**, not against emptiness. The tag workflow appends
GitHub's generated notes to the authored text (`FULL_BODY` in
`.github/workflows/build-and-make.yaml`), so the body is never empty and an emptiness test could
never fail. An internal-only release, whose public section is legitimately
empty, is reported as such rather than warned about.

An already-published release still gets its asset report — auditing one after
the fact is useful — but **never a success exit**. Reporting a pass for a
pre-publication gate after publication would claim a boundary already crossed.

### Required asset set

27 assets, verified against a real complete matrix build. When the build matrix
in `.github/workflows/build-and-make.yaml` gains or loses a target, update
`requiredAssetRules()` in the same PR.

| Platform | Assets |
| --- | --- |
| macOS | `-mac-{x64,arm64}.{dmg,zip}` + a `.blockmap` for each (8) |
| Windows | `-windows-x64-setup.exe` + `.blockmap` (2) |
| DEB | `-linux-{amd64,arm64,armv7l}.deb` (3) |
| AppImage | `-linux-{x86_64,arm64,armv7l}.AppImage` (3) |
| Snap | `-linux-{amd64,armhf}.snap` (2) |
| RPM | `-linux-x86_64.rpm` (1) |
| Flatpak | `-linux-x86_64.flatpak` (1) |
| Pacman | `-linux-x64.pacman` **or** `-linux-x86_64.pkg.tar.*` (1) |
| Updater metadata | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm.yml`, `latest-linux-arm64.yml` (5) |
| Source compliance | `linux-frame-copy-runtime-sources.tar.xz` (1) |

Electron Builder has shipped both pacman artifact shapes, so either satisfies
that rule. Rules compare plain strings rather than a regex built from the
version — `requiredAssetRules()` is exported, and escaping an interpolated
value correctly would be a standing trap.

An asset no rule claims is reported as a `NOTE:` and does **not** fail the run:
a new build target should surface for a human to notice, not block a release
until the rules catch up.

## AppImage external-manager metadata

`electron-builder.json` scopes `X-AppImage-Name`, `X-AppImage-Homepage` and
`X-AppImage-UpdateURL` to `appImage.desktop.entry`. The source URL is the
canonical GitHub repository. AppManager 3.8.0 reads these URL fields and can
discover GitHub releases and download complete AppImages. Its architecture
selection recognizes the existing `x86_64`, `arm64` and `armv7l` asset names.
Other Linux package formats do not inherit these AppImage-specific fields.
`extraMetadata.desktopName=iptvnator` preserves the existing window class and
desktop filename. Do not reintroduce a shared `linux.desktop.entry` object:
electron-builder 26.15.7's target merge mutates nested defaults, which would
leak the AppImage URL fields into Snap in the same portable packaging pass.

Electron Builder generates `X-AppImage-Version` from `appInfo.buildVersion`;
do not hardcode it in the desktop entry. `X-AppImage-Arch` is intentionally
omitted: a single runner-wide value would mislabel this multi-architecture
target. Version, preserved desktop defaults and format isolation are checked
through the installed builder in `electron-package-identity.test.mjs`.

This metadata enables AppManager's full-download workflow. It does not embed
AppImageUpdate `.upd_info`, generate `.zsync`, or change Electron's existing
`latest-linux*.yml` and embedded blockmap update path. The required release
asset set remains unchanged. Gear Lever/AppImageUpdate delta compatibility
is not implied. An older AppImage needs a first manual or built-in update,
or a manually configured AppManager source, to acquire these fields. Use one
updater at a time for a manager-owned installation.

References: [AppImage desktop keys](https://docs.appimage.org/reference/desktop-integration.html),
[AppManager desktop parser](https://github.com/kem-a/AppManager/blob/v3.8.0/src/core/desktop_entry.vala),
[AppManager updater](https://github.com/kem-a/AppManager/blob/v3.8.0/src/core/updater.vala).

## Nightly channel

Every push to `master` of `4gray/iptvnator` is also a nightly. The same
`build-and-make.yaml` run that builds the matrix publishes its artifacts as a
**prerelease of `4gray/iptvnator-nightly`** instead of the rolling
`test-master` draft: a draft is invisible to anyone without write access and
to electron-updater, while a published prerelease is what the desktop app's
**Nightly** update channel installs. PR builds keep their `test-pr-<n>`
drafts; tag builds are unaffected.

**Version.** Each build job rewrites the `package.json` version before the
frontend and backend builds and before electron-builder reads it
(`tools/release/nightly-version.mjs --apply`):

```
0.23.0  →  0.23.1-nightly.20260915.1234
           └ next patch ┘ └ commit date ┘ └ run number ┘
```

- Greater than the released `0.23.0`, so a stable user who switches channels
  is offered it; smaller than `0.23.1` and `0.24.0`, so the next stable
  release is offered to nightly users on either channel.
- The run number only grows, so nightlies order correctly within a day.
- The same `--apply` sets `publish[0].channel: nightly` in
  `electron-builder.json`, which names the updater metadata
  `nightly-mac.yml`, `nightly.yml`, `nightly-linux.yml`. electron-builder does
  not derive that name from the prerelease tag for the GitHub provider (the
  first nightly run produced `latest-*.yml` and the publish step refused
  it). The artifact upload globs and the macOS metadata merge accept both
  names.
- The root `package.json` is an Nx `sharedGlobals` input, so the rewritten
  version reaches the `web` and `electron-backend` bundles (which embed it)
  instead of a cache hit built from the released version.
- The base is the version in `package.json`. The patch is bumped only when
  `v<base>` already exists on origin. A release cut commits the bump before
  (or together with) its tag, and while that tag is missing the base is the
  UPCOMING release, so the nightly keeps its patch
  (`0.23.1` untagged → `0.23.1-nightly.<date>.<run>`): still above every
  earlier nightly, still below the imminent `0.23.1`, so nightly users are
  offered that release instead of skipping it.
- The version is computed once, in the leading `nightly-version` job, and
  handed to every build job as `--version` — a tag pushed while the matrix
  runs cannot give one run two different versions. The release job reads
  the same output to name the tag `v<version>`.

**Publication** (steps at the end of the `create-release` job):

1. `NIGHTLY_RELEASE_TOKEN` — a fine-grained PAT with *Contents: read/write*
   on `4gray/iptvnator-nightly` — is required. Without it the run only warns;
   `GITHUB_TOKEN` cannot write to another repository. The nightly repository
   needs one commit on its default branch, because `gh release create`
   creates the release tag there.
2. The notes list the master commits since the previous nightly. That
   nightly's source commit is read back from the `<!-- iptvnator-commit: … -->`
   marker its own notes carry, then `compare` on the main repository (with
   `GITHUB_TOKEN`) lists the range. A missing marker or a rewritten history
   only drops the list.
3. The release is created as a draft, assets are uploaded, then it is
   published in one edit, so electron-updater never sees a release whose
   channel file is still missing. Missing `nightly-mac.yml`,
   `nightly.yml` or `nightly-linux.yml` fails the step instead. A published
   release is never deleted by a re-run: re-running after a successful
   publish is a no-op, and only a draft left behind by a failed run is
   replaced.
4. The release job is serialized per ref, but two master runs can finish out
   of order. electron-updater takes the newest feed entry, so a nightly older
   than the newest published one is dropped rather than published.
5. Only the newest `NIGHTLY_KEEP_RELEASES` (20) nightlies are kept; older
   ones are deleted together with their tags.

**In the app.** `Settings.updateChannel` (`stable` / `nightly`, default
`stable`) is a normal renderer setting mirrored into the main-process config
by `SETTINGS_UPDATE` (`APP_UPDATE_CHANNEL`), because the startup check runs
before the renderer exists. `AppUpdateService` re-points electron-updater on
every check (`app-update-feed.ts`): the GitHub feed URL of the channel's
repository, `allowPrerelease` only for nightly, the channel name (`nightly`,
or the explicit `latest` for stable — the setter refuses `null` once set),
and `allowDowngrade = false` reset afterwards, since assigning a channel
silently enables downgrades and the constructor enables prereleases for any
prerelease build. Release notes and the manual-install fallback (Linux
without AppImage) read the channel's release list; notes for a nightly
version always come from the nightly repository, so a nightly build on the
stable channel still shows its own notes. `AppUpdateReleaseCatalogs`
(`app-update-release-notes.ts`) owns one catalog per channel and both reads
the updater performs on them (release notes with paging, newest release for
the manual-install fallback); the service only delegates. Each catalog is a
snapshot of the GitHub release list kept for the whole process, so `findIndex` reloads it
once when a version is missing from a fully paged list — the updater had
offered a nightly published after the catalog was first read, and "What's
new" answered "not found" for it — and `handleUpdateAvailable` drops every
catalog, since a newly found release proves the snapshots stale. Readers
of one catalog are serialized through `runExclusive` (both
`getReleaseNotes` and the manual-update check): a read dereferences an
index into `releases` after awaiting further pages, and that reload
rebuilds the array, so two overlapping readers must never interleave. The
not-found rejection carries the shared
`APP_UPDATE_RELEASE_NOTES_NOT_FOUND_MARKER` text: `ipcRenderer.invoke`
strips custom properties off rejections, so the dialog recognises the case
by that text, shows localized copy with the version, and links to the
channel's release list (`appUpdateReleasesListUrl`) instead of printing the
IPC wrapper; every other failure keeps its underlying reason under a
localized headline.

The About section keeps the select honest about that Save boundary. The
status block carries a badge naming the channel the verdict describes
(`status.channel`), and while the select shows a different channel the
verdict is dimmed, a hint names both channels, and the plain "Check again"
button is replaced by a primary "Save and check for <channel> updates"
button that submits the settings form
(`SettingsAboutSectionComponent.saveAndCheckForAppUpdate` →
`SettingsComponent.onSubmit()`). No renderer-side check follows: the saved
channel reaches `persistAppUpdateChannel`, whose change listener calls
`AppUpdateService.setChannel`, which already re-checks an idle updater. A
download in flight or finished belongs to the previous channel and is kept
by `setChannel`, so in those states the plain check stays and only the hint
is shown. Because that kept download outlives the channel it was found on,
every check stamps `status.verdictChannel` with the channel it ran on and
`setChannel` leaves it alone: the badge names `verdictChannel`, not
`channel`, and while the two differ a hint says the shown update came from
the other channel and the saved one has not been checked yet. Checking the unsaved channel without saving was rejected on
purpose: the updater would then offer a download for a channel that is not
persisted.

Switching is forward-only on purpose: a nightly build stays installed until
a newer stable release exists, because a downgrade could land on a release
that does not understand the database schema a nightly migration already
applied. Nightly users therefore accept that everything merged into master
is de facto shipped — a migration on master can only be followed by another
migration, never reworked.

## After verification

Publishing the GitHub release is manual. That publication automatically
verifies its Snap assets and uploads them to `edge`; installed-Snap smoke and
candidate/stable promotion remain manual (see
`tools/packaging/validate-snap-release-boundary.mjs`). Keep the blog post a
draft during artifact verification, then publish it in a follow-up commit and
verify the website deployment.

## Validation

```bash
pnpm run release:notes:validate   # every note parses and satisfies the schema
pnpm nx run release-tools:test    # the tooling's own unit tests
pnpm nx run release-tools:lint
```
