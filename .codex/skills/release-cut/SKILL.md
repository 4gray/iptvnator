---
name: release-cut
description: Use when preparing, cutting, tagging, publishing, or verifying an IPTVnator release or its release assets.
---

# Release Cut

The tag build takes authored public text from the new CHANGELOG section. Keep
the full changelog committed before tagging.

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
5. Consume notes only after reviewing all generated output:
   `node tools/release/build-release-notes.mjs --consume`.

The consume command is the destructive boundary: it deletes the direct note
files. Stage only release-owned files, including exact website post/assets and
`git add -A -- .changes`, then commit and create the exact tag.

```bash
git commit -m "chore(release): v0.24.0"
git tag v0.24.0
```

## Push and External Effects

Push only the intended branch and tag; never use broad `git push --tags`.

```bash
git push --atomic origin \
  HEAD:refs/heads/master \
  refs/tags/v0.24.0
```

Master and `v*` pushes can publish Docker images. The tag build creates a draft
GitHub release. Verify authored text plus generated commits and all required
macOS, Windows, DEB, RPM, Pacman (`.pacman`/`.pkg.tar.*`), AppImage, Snap,
Flatpak, updater metadata, blockmaps, and
`linux-frame-copy-runtime-sources.tar.xz`.

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
