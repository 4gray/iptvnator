---
name: release-cut
description: Use when preparing, cutting, tagging, publishing, or verifying an IPTVnator release or its release assets.
---

# Release Cut

Full contract, asset table and rationale: `docs/architecture/release-pipeline.md`.

The tag workflow authors the public GitHub body with
`node tools/release/extract-changelog-section.mjs --public "${VERSION}"`.
Keep the full changelog, including internal notes, committed before tagging.

## Preflight

Work from clean, current `master` with the intended remote named explicitly.
Confirm `package.json` contains bare semver, the exact `v<version>` tag does not
exist locally or remotely, CI is green, and all notes validate.

```bash
pnpm run release:notes:validate
pnpm run i18n:check
```

## Generate

1. Set `package.json.version`.
2. Run `pnpm run release:notes:changelog`.
3. Minor release: run `pnpm run release:notes:blog` and finish every editorial
   field. Patch release: edit the existing `vX-Y` post; do not scaffold or
   force-overwrite it.
4. Capture required manifest screenshots only against mock servers:
   `pnpm nx run electron-backend:build-e2e`, then
   `pnpm run release:screenshots`.
5. Render the announcement drafts, saving output outside the repository:
   `pnpm --silent run release:notes:telegram` and the `:reddit` counterpart
   (`--silent`, or pnpm's lifecycle banner lands in the saved post).
6. Render highlight cards after the screenshots:
   `pnpm run release:cards:generate`. Review them; copy `hero.jpg` into the
   blog post's asset directory if it should ship as the hero image.
7. Consume notes only after reviewing all generated output:
   `node tools/release/build-release-notes.mjs --consume`.

Steps 5 and 6 must precede `--consume`: `highlight:` exists only in the note
files it deletes. Publishing announcements is manual, after the release.

The consume command is the destructive boundary: it deletes the direct note
files. Stage only release-owned files, including exact website post/assets and
`git add -A -- .changes`, then commit and create the exact tag.

```bash
git commit -m "chore(release): v0.24.0"
git tag v0.24.0
```

## Push and External Effects

Push the named remote's `master` branch first, then push only the exact
`v<version>` tag as a second command. Never use broad `git push --tags`.
For remote `upstream` and version `v0.25.1`, run exactly:

```bash
git push upstream master
git push upstream v0.25.1
```

Master and `v*` pushes can publish Docker images. The tag build creates a draft
GitHub release. Run `pnpm run release:verify:draft` — it waits for the tag
build, then checks draft status, warns on an empty authored body, and verifies
the complete 27-asset set documented in `docs/architecture/release-pipeline.md`.
It is read-only, and fails on an already-published release. Still review the
authored text and generated commits by eye.

After verification, manually publish the GitHub release. That publication
automatically verifies its Snap assets and uploads them to `edge`.
Installed-Snap smoke and candidate/stable promotion remain manual. Keep the
blog draft during artifact verification; publish it in a follow-up commit and
verify the website deployment.

## Failure Safety

Missing CHANGELOG section: regenerate, commit, delete the bad tag locally and
remotely only after resolving its exact target, then retag. Never publish a
draft until the source archive and Snap contract pass.

The `.codex` and `.claude` copies of this skill must remain byte-identical.
