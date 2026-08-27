---
name: release-notes
description: "Use when a change may need a .changes note, the Release note gate fails, or deciding whether type: internal or no-release-note applies."
---

# Release Notes

Every user-visible change gets one direct `.changes/<area>-<slug>.md` file. The
area matches the conventional-commit scope; the body is present tense, user
language, one to three sentences, and at most 400 characters.

## Format

```markdown
---
type: fix
area: stalker
issues: [1234]
screenshot: optional-manifest-slug
highlight: Optional short headline
---

Stalker series now resume the correct episode.
```

`type` is `breaking`, `feature`, `fix`, `perf`, or `internal`. Omit optional
fields instead of inventing values. Never add a version or PR number.

`highlight` (max 60 characters, never on `internal`) names a headline feature:
it leads the Telegram/Reddit announcement drafts and becomes the blog section
heading. Reserve it for the two or three changes worth announcing.

`internal` records invisible maintenance. It stays collapsed in `CHANGELOG.md`
but is omitted from the blog and the authored public GitHub body. GitHub's
generated commit list may still mention the underlying commits.

## Skip or Label

The gate auto-exempts website, E2E and mock-server apps, `*.spec.{js,ts}`,
`*.e2e.{js,ts}`, snapshots, any `/testing/` path, and Markdown. Other test-only,
docs, CI, workflow, or pure-refactor PRs use `no-release-note` when the gate
would otherwise require a note. At least one newly added direct
`.changes/*.md` file satisfies the gate.

## Verify

```bash
pnpm run release:notes:validate
```

Full format: `.changes/README.md`. Gate policy:
`tools/release/check-release-note-gate.mjs`.

The `.codex` and `.claude` copies of this skill must remain byte-identical.
