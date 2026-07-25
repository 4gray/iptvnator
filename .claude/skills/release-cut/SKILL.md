---
name: release-cut
description: Cut an IPTVnator release — bump the version, generate release notes from .changes/, scaffold the website post, tag, and verify the draft. Use when asked to release, cut a version, prepare release notes, or publish a new version.
---

# Release Cut

The pipeline turns accumulated `.changes/*.md` notes into all three release
surfaces. Order matters: **the tag build extracts the CHANGELOG section into
the GitHub release body and fails if it is missing**, so the changelog step
is not optional.

## Sequence

1. **Pick the version** — deliberate choice, edit `version` in the root
   `package.json`. Bare semver only: any suffix flips electron-updater into
   prerelease mode and leaks into installer version fields.

2. **Review the notes** — read every file in `.changes/`. Fix wording (user
   language, not reviewer language), then:

    ```bash
    pnpm run release:notes:validate
    ```

3. **Generate the changelog section** (idempotent per version — rerunning
   replaces the section, so regenerate freely until it reads well):

    ```bash
    pnpm run release:notes:changelog
    ```

4. **Scaffold the website post**:

    ```bash
    pnpm run release:notes:blog
    ```

    Output is `apps/website/src/content/blog/v0-XX-release-notes.mdx` with
    `draft: true`. The narrative intro, headlines, and `description` are
    editorial — fill every `TODO` by hand. One post per **minor** version:
    for a patch release, edit the existing post (the scaffold refuses to
    overwrite without `--force`).

5. **Screenshots** — only from the fail-closed capture script against the
   mock servers, never from a real playlist or account: real streams, logos,
   and TMDB artwork are copyrighted, and credentials must never reach a
   published image.

    ```bash
    pnpm nx run electron-backend:build-e2e   # once
    pnpm run release:screenshots             # all manifest shots, dark+light
    ```

    Output goes to `apps/website/public/blog/v0-XX/screenshots/`. New feature
    to showcase = new entry in `tools/release/screenshots.manifest.json`
    (slug must match the note's `screenshot:` field). The run aborts and
    deletes its frames on any guard violation (real-DB touch, external
    request, credential-shaped text in frame, TMDB active).

6. **Consume the notes** (the only destructive step):

    ```bash
    node tools/release/build-release-notes.mjs --consume
    ```

7. **Commit, tag, push**:

    ```bash
    git add CHANGELOG.md .changes apps/website package.json
    git commit -m "chore(release): v0.XX.0"
    git tag v0.XX.0 && git push && git push --tags
    ```

8. **Verify the draft release** once `build-and-make.yaml` finishes: authored
   notes on top, GitHub's generated commit list below, all platform assets
   present (`.dmg`/`.zip` + `latest-mac.yml`, `.exe`/`.msi` + `latest.yml`,
   `.deb`/`.rpm`/`.AppImage`/`.snap`/`.flatpak` + `latest-linux*.yml`,
   blockmaps). Publish manually; flip the blog post to `draft: false`.

## Failure modes

- **create-release fails with "CHANGELOG.md has no section for X"** — step 3
  was skipped. Run it, commit, delete and re-push the tag.
- **Snap store publication** is a separate manual flow after the public
  release exists (`publish-snap.yaml`).
- Post-release checklist candidates: i18n drift (`pnpm run i18n:check`),
  update the website `v0-XX` blog assets, announce in Telegram.
