---
name: release-notes
description: Write the .changes/ release note that every PR with a user-visible change must include. Use when creating or finishing a PR that changes behavior in apps/ or libs/, when the "Release note gate" CI check fails, or when deciding whether the no-release-note label applies.
---

# Release Notes (`.changes/`)

Every PR with a user-visible change adds **one** note file under `.changes/`.
At release time the notes become the GitHub release body, the `CHANGELOG.md`
section, and the website blog scaffold. CI enforces this: the **Release note
gate** check fails any PR that touches runtime code under `apps/` or `libs/`
without an added `.changes/*.md` file or the `no-release-note` label.

## File format

Name: `.changes/<area>-<short-slug>.md` — `area` matches the
conventional-commit scope of the PR.

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

| Field        | Required | Value                                                |
| ------------ | -------- | ---------------------------------------------------- |
| `type`       | yes      | `breaking` / `feature` / `fix` / `perf` / `internal`  |
| `area`       | yes      | lowercase slug = conventional-commit scope            |
| `issues`     | no       | `[1187]` or bare `1187` — issues this PR closes       |
| `screenshot` | no       | slug from the release screenshot manifest             |

- **No version field.** The release version is chosen at release time.
- **Never write a PR number.** The generator resolves it from git.
- Unknown keys fail validation — this is what catches typos like `scopr:`.

## Writing the body

One to three sentences, present tense, max 400 characters, **written for a
user, not a reviewer**:

- ❌ "Refactor `WebVideoControlsAdapter` to hoist volume state"
- ✅ "The player now remembers volume between episodes"
- ❌ "Fix off-by-one in `resolveEnrichmentSeasonNumber`"
- ✅ "Series with a season marker in the title no longer show the wrong season"

`type: internal` is for changes worth recording but invisible to users
(dependency bumps with behavior risk, packaging moves). They are excluded
from the release body and blog, and collapsed in `CHANGELOG.md`.

## When to skip (`no-release-note` label)

Test-only changes, docs, CI/workflow plumbing, pure refactors with no
behavior change. The gate auto-exempts `*.spec.ts`, `*.e2e.ts`,
`__snapshots__/`, `apps/website/`, `apps/*-e2e/`, `apps/*-mock-server/`,
`libs/shared/testing/` and `*.md` — if only those changed, no label needed.

## Verify before finishing

```bash
pnpm run release:notes:validate
```

Full format reference: `.changes/README.md`. Gate policy:
`tools/release/check-release-note-gate.mjs`.
