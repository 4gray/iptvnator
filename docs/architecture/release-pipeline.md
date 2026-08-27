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
sees. `highlight-cards.test.mjs` renders each sample through sharp and asserts
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
  changes grouped below.
- **The blog scaffold** uses the highlight as a ready `###` heading instead of
  emitting `TODO headline (<area>)`.

Prose fields keep `#`. `parseFrontmatterLine` strips trailing `# comment` text
only from closed-vocabulary fields (`type`, `area`, `issues`, `screenshot`),
whose values can never contain one — `highlight: Sources #N chip` is a headline.

### Internal-only releases

A release whose notes are all `type: internal` is a legal shape: the authored
GitHub body is empty and GitHub's generated commit list carries the detail.
Both announcement formats then print an explanation on stderr, leave stdout
empty, and exit 0 — the same shape `extract-changelog-section.mjs --public`
already uses for its empty public body.

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
`build-and-make.yaml`), so the body is never empty and an emptiness test could
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
