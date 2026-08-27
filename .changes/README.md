# Release notes (`.changes/`)

Every PR with a user-visible change drops one file here describing that change
in plain language. At release time
`tools/release/build-release-notes.mjs` turns the accumulated files into the
GitHub release body, the `CHANGELOG.md` section, a blog-post scaffold for
the website, and Telegram/Reddit announcement drafts — then deletes them.

The point is to write the note **while the context is still fresh**, instead of
reconstructing three months of work from commit titles at release time.

## File

Name it `<area>-<short-slug>.md`, e.g. `.changes/playback-up-next-rail.md`.

```markdown
---
type: feature
area: playback
issues: [1187]
screenshot: up-next-rail
highlight: Up Next rail
---

Series now show an "Up Next" rail beside the player on wide windows: the rest
of the current season, watch progress, and click-to-play inline.
```

| Field        | Required | Value                                                       |
| ------------ | -------- | ----------------------------------------------------------- |
| `type`       | yes      | `breaking`, `feature`, `fix`, `perf`, or `internal`          |
| `area`       | yes      | lowercase slug, same as the conventional-commit scope        |
| `issues`     | no       | issue numbers this closes — `[1187]` or `1187`               |
| `screenshot` | no       | slug from `tools/release/screenshots.manifest.json`          |
| `highlight`  | no       | short headline (max 60 chars) marking a release highlight    |

There is **no version field**. The release version is chosen deliberately at
release time, not derived from these files.

You never write a PR number: the generator resolves it from the commit that
added the file.

## Writing the body

One to three sentences, present tense, **written for a user, not a reviewer**.
The body is capped at 400 characters — depth belongs in the blog post.

- ❌ "Refactor `WebVideoControlsAdapter` to hoist volume state into the session"
- ✅ "The player now remembers volume between episodes"

- ❌ "Fix off-by-one in `resolveEnrichmentSeasonNumber`"
- ✅ "Series whose title carries a season marker no longer show the wrong season"

`highlight` marks the change as one of the release's headline features and
gives it a short, poster-worthy name. The 60-character cap is the hero card's
single-line budget, so a valid highlight always renders in full. Highlights lead the Telegram/Reddit
announcements (everything else collapses into a "+N more" counter) and become
ready-made section headings in the blog scaffold. Set it on the two or three
changes worth announcing — a release where everything is a highlight has none.
Not allowed on `type: internal`.

`type: internal` records invisible maintenance. Internal notes stay collapsed in
`CHANGELOG.md`, are omitted from the blog scaffold, and are removed from the
authored public GitHub body by
`extract-changelog-section.mjs --public`. GitHub's generated commit list remains
separate. An internal-only release can therefore have an empty authored body.

## When a note is not needed

The gate auto-exempts website, E2E and mock-server apps, `*.spec.{js,ts}`,
`*.e2e.{js,ts}`, snapshots, any `/testing/` path, and Markdown. For other
test-only, documentation, CI/workflow, or pure-refactor changes under
`apps/`/`libs/`, apply `no-release-note` when no user-visible note is warranted.

## Commands

```bash
pnpm run release:notes:validate
pnpm run release:notes:github
pnpm run release:notes:changelog
pnpm run release:notes:blog
pnpm run release:notes:telegram
pnpm run release:notes:reddit
node tools/release/build-release-notes.mjs --consume
```

The release version comes from the root `package.json` — bump it first, then
generate. `--version 0.24.0` overrides it to preview a release before the bump:

```bash
pnpm run release:notes:github --version 0.24.0
```

A bare `--` separator is accepted and ignored, so the npm habit of
`pnpm run release:notes:github -- --version 0.24.0` works too: pnpm forwards
that separator to the script rather than consuming it the way npm does.

`--validate`, `--format github`, `--format telegram`, and `--format reddit`
only read and print. `--format changelog` and `--format blog` write their
target file (rerunning `changelog` for the same version replaces that section
rather than duplicating it). Only `--consume` deletes anything.

The announcement formats print paste-ready posts to stdout: Telegram plain
text guaranteed to fit the 4096-character limit, Reddit markdown with a
suggested post title on the first line. Render and save them **before**
`--consume` — the changelog keeps the entries, but the `highlight:` metadata
lives only in the note files. Publishing is manual; nothing posts anywhere.
An internal-only release has nothing to announce: both formats then print an
explanation on stderr, leave stdout empty, and exit 0 — the same shape
`extract-changelog-section.mjs --public` uses for its empty public body.

The release sequence is: bump the version → `release:notes:changelog` →
`release:notes:blog` → `release:screenshots` → `release:notes:telegram` /
`release:notes:reddit` → `release:cards:generate` → `--consume` → commit → tag
→ push → `release:verify:draft`. Everything reading `highlight:` comes before
`--consume`, because that step deletes the only copy of it. Full contract:
`docs/architecture/release-pipeline.md`. The tag build then
extracts the new `CHANGELOG.md` section into the GitHub release body
(`tools/release/extract-changelog-section.mjs`) and **fails the release** if
the section is missing — a tag cut without the changelog step cannot silently
ship PR-title-only notes.

The website publishes **one post per minor version** (`v0-18` … `v0-22`), and
release screenshots live under the matching `blog/v0-24/` directory. A patch
release therefore edits the existing post rather than generating a new one, so
`--format blog` refuses to overwrite unless you pass `--force`.

## Screenshots

`pnpm run release:screenshots` captures every manifest shot in dark and light
against the built app plus the Xtream mock server — never a real account.
The run is fail-closed: it proves the real `~/.iptvnator/databases` directory
(including the SQLite WAL sidecars, checked after Electron exits) was not
touched, launches the app with an allowlisted environment, records and blocks
all non-localhost traffic, scans every frame for external resources and
credential-shaped text, and asserts TMDB enrichment stays disabled. Frames are
staged outside the repository and published only once every shot and every
guard has passed.

Adding a shot for a new feature = one entry in
`tools/release/screenshots.manifest.json` (plus, if navigation is new, one
named action in `tools/release/capture-navigation.ts`).

## Highlight cards

`pnpm run release:cards:generate` renders one branded 1200×630 card per
`highlight:` note (headline, body, and a framed screenshot strip when the note
names one) plus a release hero card — for Telegram/Reddit previews and the
blog `hero.jpg`. It reads screenshots from the published blog directory, so it
runs after `release:screenshots` and, like the announcement formats, before
`--consume`. Output goes to `dist/release-highlight-cards/<vX-Y>/`; copying a
card into the website tree is a deliberate manual act.
`release:cards:dry-run` lists what would be rendered.

```bash
pnpm nx run electron-backend:build-e2e   # once, before capturing
pnpm run release:screenshots             # all shots, both themes
pnpm run release:screenshots -- --only dashboard --theme dark
pnpm run release:screenshots -- --release v0-24
```
