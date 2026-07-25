# Release notes (`.changes/`)

Every PR with a user-visible change drops one file here describing that change
in plain language. At release time
`tools/release/build-release-notes.mjs` turns the accumulated files into the
GitHub release body, the `CHANGELOG.md` section, and a blog-post scaffold for
the website — then deletes them.

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
---

Series now show an "Up Next" rail beside the player on wide windows: the rest
of the current season, watch progress, and click-to-play inline.
```

| Field        | Required | Value                                                       |
| ------------ | -------- | ----------------------------------------------------------- |
| `type`       | yes      | `breaking`, `feature`, `fix`, `perf`, or `internal`          |
| `area`       | yes      | lowercase slug, same as the conventional-commit scope        |
| `issues`     | no       | issue numbers this closes — `[1187]` or `1187`               |
| `screenshot` | no       | slug from the release screenshot manifest                    |

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

`type: internal` is for changes with no user-visible effect that are still worth
recording (dependency bumps with behaviour risk, packaging moves). They stay out
of the release body and blog post, and land collapsed in `CHANGELOG.md`.

## When a note is not needed

Skip the note — and apply the `no-release-note` label — for test-only changes,
docs, CI/workflow plumbing, and pure refactors with no behaviour change.

## Commands

```bash
pnpm run release:notes:validate
pnpm run release:notes:github
pnpm run release:notes:changelog
pnpm run release:notes:blog
node tools/release/build-release-notes.mjs --consume
```

The release version comes from the root `package.json` — bump it first, then
generate. `--version 0.24.0` overrides it for a dry run before the bump.

Only `--consume` deletes anything; every other mode is a safe dry run.

The release sequence is: bump the version → `release:notes:changelog` →
`release:notes:blog` → `--consume` → commit → tag → push. The tag build then
extracts the new `CHANGELOG.md` section into the GitHub release body
(`tools/release/extract-changelog-section.mjs`) and **fails the release** if
the section is missing — a tag cut without the changelog step cannot silently
ship PR-title-only notes.

The website publishes **one post per minor version** (`v0-18` … `v0-22`), and
release screenshots live under the matching `blog/v0-24/` directory. A patch
release therefore edits the existing post rather than generating a new one, so
`--format blog` refuses to overwrite unless you pass `--force`.
