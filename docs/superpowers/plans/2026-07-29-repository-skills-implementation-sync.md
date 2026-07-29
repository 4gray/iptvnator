# Repository Skills and Implementation Synchronization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize IPTVnator's eight repository skills with current implementation, filter internal notes from public releases, and fix Stalker series flag and playback-position identity defects without losing legacy progress.

**Architecture:** Keep the three workstreams independently testable: release output and guidance, provider-local Stalker compatibility, and repository skill/document maintenance. Release filtering is an additive public-extraction mode; Stalker compatibility uses series-scoped IDs plus an explicit legacy alias; mechanical skill constraints become a small dependency-free validator.

**Tech Stack:** Node.js `node:test`, GitHub Actions YAML, Angular 21 signals and standalone services, TypeScript, Jest, Nx, Markdown skills and architecture documentation.

---

## Execution Order and Commit Boundaries

1. Bootstrap the locked workspace.
2. Add public release extraction.
3. Wire the release workflow and guidance.
4. Normalize Stalker series flags.
5. Add series-scoped Stalker episode IDs.
6. Reconcile and migrate legacy Stalker positions.
7. Document the Stalker behavior and add its release note.
8. Add mechanical repository-skill validation.
9. Refresh Nx and SQLite skills/docs.
10. Refresh theme, UI, Xtream, and Stalker skills/docs.
11. Run skill application scenarios and the complete validation ladder.

Execute Tasks 1-11 strictly in numbered order in the shared worktree. Tasks 5
and 6 must use the same worker because Task 6 consumes Task 5's deliberately
uncommitted interface changes. Do not parallelize edits, tests, staging, or
commits: the workers share one filesystem, Git index, and `HEAD`, and Task 5's
temporary signature change can also invalidate project-wide checks. Read-only
audits and reviews may run in parallel, but each task's implementation and
commit must finish before the next begins.

### Task 1: Bootstrap and establish the baseline

**Files:**
- Verify: `package.json`
- Verify: `pnpm-lock.yaml`
- Verify: `docs/superpowers/specs/2026-07-29-repository-skills-implementation-sync-design.md`

- [ ] **Step 1: Confirm the intended branch and clean starting point**

Run:

```bash
git branch --show-current
git status --short
```

Expected: branch is `agent/skill-implementation-sync`; status is clean.

- [ ] **Step 2: Install the locked dependencies**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0 and no change to `pnpm-lock.yaml`.

- [ ] **Step 3: Verify Nx workspace discovery**

Run:

```bash
pnpm nx show projects
```

Expected: output includes `release-tools`, `portal-stalker-data-access`,
`portal-stalker-feature`, `shared-interfaces`, `web`, and `web-e2e`.

- [ ] **Step 4: Record fresh behavior baselines**

Run:

```bash
node --test --test-reporter=tap tools/release/release-notes.test.mjs
pnpm exec jest \
  --config libs/portal/stalker/data-access/jest.config.ts \
  --runInBand \
  libs/portal/stalker/data-access/src/lib/stalker-series.adapters.spec.ts
pnpm exec jest \
  --config libs/portal/stalker/feature/jest.config.ts \
  --runInBand \
  libs/portal/stalker/feature/src/lib/stalker-catalog-facade.service.spec.ts
```

Expected: the existing tests pass before new red tests are introduced.

### Task 2: Filter internal notes from the public release body

**Files:**
- Modify: `tools/release/release-notes.test.mjs:21`
- Modify: `tools/release/release-notes.test.mjs:446`
- Modify: `tools/release/extract-changelog-section.mjs:27`

- [ ] **Step 1: Hoist the shared fixture and add seven failing contracts**

Move the existing `const changelog = [...]` fixture from inside
`describe('extractSection')` to module scope immediately before that suite, so
the existing and new suites share it. Add a module-level
`internalOnlyChangelog` fixture with the current generated internal block.
Import `extractPublicSection`, `parseExtractArguments`, and `runExtractorCli`
beside `extractSection`, then add four public-extraction tests:

```js
describe('extractPublicSection', () => {
    it('removes the generated internal block from a mixed release', () => {
        assert.equal(
            extractPublicSection(changelog, '0.24.0'),
            ['### Features', '', '- **playback** — Up Next rail.'].join('\n')
        );
    });

    it('leaves a public-only release unchanged', () => {
        const publicOnly =
            '# 0.24.0 (2026-08-01)\n\n### Fixes\n\n- public fix';

        assert.equal(
            extractPublicSection(publicOnly, '0.24.0'),
            '### Fixes\n\n- public fix'
        );
    });

    it('returns an empty body for an internal-only release', () => {
        assert.equal(
            extractPublicSection(internalOnlyChangelog, '0.24.0'),
            ''
        );
    });

    it('preserves unrelated details blocks', () => {
        const source = [
            '# 0.24.0 (2026-08-01)',
            '',
            '<details>',
            '<summary>Migration guide</summary>',
            '',
            'Keep this text.',
            '',
            '</details>',
            '',
            '<details>',
            '<summary>Internal changes</summary>',
            '',
            '- **deps** — parser bump.',
            '',
            '</details>',
        ].join('\n');
        const result = extractPublicSection(source, '0.24.0');

        assert.match(result, /<summary>Migration guide<\/summary>/);
        assert.match(result, /Keep this text\./);
        assert.doesNotMatch(result, /Internal changes|parser bump/);
    });
});
```

Add direct CLI-contract coverage without spawning a process or reading the
repository's real changelog:

```js
describe('extract changelog CLI contract', () => {
    it('parses --public before the version', () => {
        assert.deepEqual(
            parseExtractArguments(['--public', '0.24.0']),
            { version: '0.24.0', publicOnly: true }
        );
    });

    it('rejects malformed, unknown, duplicate, or extra arguments', () => {
        for (const args of [
            [],
            ['0.24'],
            ['--unknown', '0.24.0'],
            ['--public', '--public', '0.24.0'],
            ['0.24.0', 'extra'],
        ]) {
            assert.equal(parseExtractArguments(args), null);
            const result = runExtractorCli(changelog, args);
            assert.equal(result.exitCode, 2);
            assert.equal(result.stdout, '');
            assert.match(result.stderr, /Usage:/);
        }
    });

    it('exits successfully with no output for an internal-only public body', () => {
        assert.deepEqual(
            runExtractorCli(
                internalOnlyChangelog,
                ['--public', '0.24.0']
            ),
            { exitCode: 0, stdout: '', stderr: '' }
        );
    });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tools/release/release-notes.test.mjs
```

Expected: FAIL because the module does not export the three new functions.

- [ ] **Step 3: Implement exact-block public extraction**

Add to `extract-changelog-section.mjs`:

```js
const INTERNAL_DETAILS_BLOCK =
    /(?:^|\n\n)<details>\n<summary>Internal changes<\/summary>\n\n[\s\S]*?\n\n<\/details>(?=\n\n|$)/g;

/**
 * Extracts the authored public body while preserving the complete changelog.
 *
 * @param {string} changelog full CHANGELOG.md content
 * @param {string} version bare semver
 * @returns {string | null}
 */
export function extractPublicSection(changelog, version) {
    const section = extractSection(changelog, version);

    return section === null
        ? null
        : section.replace(INTERNAL_DETAILS_BLOCK, '').trim();
}
```

Add pure argument and CLI-result boundaries:

```js
const CLI_USAGE =
    'Usage: extract-changelog-section.mjs [--public] <version>';

export function parseExtractArguments(args) {
    const publicFlagCount = args.filter(
        (argument) => argument === '--public'
    ).length;
    const positional = args.filter(
        (argument) => argument !== '--public'
    );

    if (
        publicFlagCount > 1 ||
        positional.length !== 1 ||
        !/^\d+\.\d+\.\d+$/.test(positional[0])
    ) {
        return null;
    }

    return {
        version: positional[0],
        publicOnly: publicFlagCount === 1,
    };
}
```

Export `runExtractorCli(changelog, args)` returning
`{ exitCode, stdout, stderr }`. It must:

- return exit 2 plus `CLI_USAGE` for invalid arguments;
- select `extractPublicSection` only in public mode;
- preserve the existing detailed missing-section diagnostic and exit 1;
- preserve the raw-mode empty-section diagnostic and exit 1; and
- return exit 0 with empty stdout/stderr for an internal-only public section.

Refactor `main()` into a thin adapter: read `CHANGELOG.md`, call
`runExtractorCli(changelog, process.argv.slice(2))`, write the returned stdout
and stderr to their matching streams, and assign `process.exitCode`. Keep the
existing import guard.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
node --test --test-reporter=tap tools/release/release-notes.test.mjs
```

Expected: 44 tests pass, 0 fail.

- [ ] **Step 5: Commit the public extractor**

```bash
git add \
  tools/release/extract-changelog-section.mjs \
  tools/release/release-notes.test.mjs
git commit -m "fix(release): filter internal notes from public body"
```

### Task 3: Wire public release extraction and synchronize release guidance

**Files:**
- Modify: `tools/release/release-notes.test.mjs`
- Modify: `tools/release/project.json`
- Modify: `.github/workflows/build-and-make.yaml`
- Modify: `.changes/README.md`
- Modify: `.codex/skills/release-cut/SKILL.md`
- Modify: `.claude/skills/release-cut/SKILL.md`
- Modify: `.codex/skills/release-notes/SKILL.md`
- Modify: `.claude/skills/release-notes/SKILL.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a failing workflow contract test**

Add `readFileSync` to the existing `node:fs` import and add:

```js
it('uses public extraction for authored tag-release text', () => {
    const workflow = readFileSync(
        new URL(
            '../../.github/workflows/build-and-make.yaml',
            import.meta.url
        ),
        'utf8'
    );

    assert.match(
        workflow,
        /extract-changelog-section\.mjs --public "\$\{VERSION\}"/
    );
});
```

- [ ] **Step 2: Run the workflow contract test and verify RED**

Run:

```bash
node --test tools/release/release-notes.test.mjs
```

Expected: FAIL because `build-and-make.yaml` does not pass `--public`.

- [ ] **Step 3: Make the workflow request public output**

Change the tag command to:

```bash
BODY="$(node tools/release/extract-changelog-section.mjs --public "${VERSION}")"
```

Update the nearby workflow comment to state that the complete changelog keeps
internal notes and an internal-only release intentionally has no authored
public text. Add this input to `release-tools:test`:

```json
"{workspaceRoot}/.github/workflows/build-and-make.yaml"
```

- [ ] **Step 4: Run the workflow contract test and verify GREEN**

Run:

```bash
node --test --test-reporter=tap tools/release/release-notes.test.mjs
```

Expected: 45 tests pass, 0 fail.

- [ ] **Step 5: Replace the release-notes skill and its mirror**

Apply this exact content to both release-notes skill paths:

````markdown
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
---

Stalker series now resume the correct episode.
```

`type` is `breaking`, `feature`, `fix`, `perf`, or `internal`. Omit optional
fields instead of inventing values. Never add a version or PR number.

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
````

- [ ] **Step 6: Replace the release-cut skill and its mirror**

Apply this exact content to both release-cut skill paths:

````markdown
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
````

- [ ] **Step 7: Synchronize canonical release documentation**

Replace the `internal` paragraph in `.changes/README.md` with:

```markdown
`type: internal` records invisible maintenance. Internal notes stay collapsed in
`CHANGELOG.md`, are omitted from the blog scaffold, and are removed from the
authored public GitHub body by
`extract-changelog-section.mjs --public`. GitHub's generated commit list remains
separate. An internal-only release can therefore have an empty authored body.
```

Replace its skip guidance with the exact gate behavior:

```markdown
The gate auto-exempts website, E2E and mock-server apps, `*.spec.{js,ts}`,
`*.e2e.{js,ts}`, snapshots, any `/testing/` path, and Markdown. For other
test-only, documentation, CI/workflow, or pure-refactor changes under
`apps/`/`libs/`, apply `no-release-note` when no user-visible note is warranted.
```

Add the same public/internal distinction and automatic Snap `edge`/Docker side
effects to the mirrored release-policy sections in `AGENTS.md` and `CLAUDE.md`.
Keep their process bullets textually synchronized.

- [ ] **Step 8: Verify release guidance and mirrors**

Run:

```bash
cmp -s \
  .codex/skills/release-cut/SKILL.md \
  .claude/skills/release-cut/SKILL.md
cmp -s \
  .codex/skills/release-notes/SKILL.md \
  .claude/skills/release-notes/SKILL.md
! rg -n '^[[:space:]]*git push .*--tags' \
  .codex/skills/release-cut/SKILL.md \
  .claude/skills/release-cut/SKILL.md
! rg -n 'separate manual flow' \
  .codex/skills/release-cut/SKILL.md \
  .claude/skills/release-cut/SKILL.md
node --test \
  tools/release/release-notes.test.mjs \
  tools/release/release-note-gate.test.mjs \
  tools/release/build-release-notes.test.mjs \
  tools/release/screenshot-guards.test.mjs
pnpm nx test release-tools
```

Expected: both `cmp` commands and both negated `rg` checks exit 0; no
executable broad tag push or stale manual-flow wording exists; all release
tests pass.

- [ ] **Step 9: Commit workflow and release guidance**

```bash
git add \
  .github/workflows/build-and-make.yaml \
  tools/release/project.json \
  tools/release/release-notes.test.mjs \
  .changes/README.md \
  .codex/skills/release-cut/SKILL.md \
  .codex/skills/release-notes/SKILL.md \
  .claude/skills/release-cut/SKILL.md \
  .claude/skills/release-notes/SKILL.md \
  AGENTS.md \
  CLAUDE.md
git commit -m "docs(release): synchronize release workflow guidance"
```

### Task 4: Normalize every Stalker series flag decision

**Files:**
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-facade.service.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-facade.service.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-series.feature.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-series.feature.ts`
- Verify: `libs/portal/stalker/data-access/src/lib/stalker-vod.utils.ts`

- [ ] **Step 1: Add selection characterization and a failing progress regression**

In `stalker-catalog-facade.service.spec.ts`, retain the store mock in a local
variable and add parameterized coverage:

```ts
it.each([true, 1, '1'] as const)(
    'selects a VOD series when is_series is %p',
    (isSeries) => {
        const service = TestBed.inject(StalkerCatalogFacadeService);
        const store = TestBed.inject(StalkerStore) as unknown as {
            setSelectedItem: jest.Mock;
        };

        service.selectItem({
            id: '42',
            name: 'Boolean Series',
            is_series: isSeries,
        });

        expect(store.setSelectedItem).toHaveBeenCalledWith(
            expect.objectContaining({ id: '42', is_series: true })
        );
    }
);

it.each([true, 1, '1'] as const)(
    'reports series progress semantics when is_series is %p',
    (isSeries) => {
        const service = TestBed.inject(StalkerCatalogFacadeService);

        expect(
            service.getItemProgress({
                id: '42',
                name: 'Series',
                is_series: isSeries,
            })
        ).toEqual({ hasSeriesProgress: false });
    }
);
```

Add `false` and `0` non-series cases that expect an undefined normalized
`is_series` selection field and ordinary VOD progress
`{ progress: 0, isWatched: false }`.

Use the smallest valid `StalkerVodSource` fixture accepted by the compiler; do
not cast away missing required fields if the existing factory already provides
one.

- [ ] **Step 2: Run the facade spec and verify RED**

Run:

```bash
pnpm exec jest \
  --config libs/portal/stalker/feature/jest.config.ts \
  --runInBand \
  libs/portal/stalker/feature/src/lib/stalker-catalog-facade.service.spec.ts
```

Expected: the boolean progress case fails because the facade currently checks
only `1` and `'1'`. Selection cases already pass through normalization inside
`buildStalkerSelectedVodItem`; they are characterization coverage for removing
the redundant local comparison.

- [ ] **Step 3: Route facade and detail decisions through the normalizer**

Import `isStalkerSeriesFlag` from
`@iptvnator/portal/stalker/data-access`. Replace both direct comparisons in
`StalkerCatalogFacadeService`:

```ts
const needsSeriesFetch =
    this.contentType() === 'vod' && isStalkerSeriesFlag(item.is_series);
```

```ts
const isSeries =
    this.contentType() === 'series' ||
    isStalkerSeriesFlag(item.is_series);
```

Use the same helper in `StalkerCatalogDetailComponent.isSeriesDetail`:

```ts
return Boolean(
    item &&
        (this.contentType() === 'series' ||
            isStalkerSeriesFlag(item.is_series))
);
```

- [ ] **Step 4: Lock the store resource to the same three-value contract**

Change the `vodSeriesSeasonsResource` guard in
`with-stalker-series.feature.ts` from truthiness to:

```ts
!isStalkerSeriesFlag(selectedItem.is_series)
```

Import the helper from `../../stalker-vod.utils`. In
`with-stalker-series.feature.spec.ts`, parameterize the existing
`is_series: '1'` resource test over `true`, `1`, and `'1'`, and add one
unsupported truthy value such as `'true'` that must not issue the season
request.

- [ ] **Step 5: Run targeted Stalker tests and verify GREEN**

Run:

```bash
pnpm exec jest \
  --config libs/portal/stalker/feature/jest.config.ts \
  --runInBand \
  libs/portal/stalker/feature/src/lib/stalker-catalog-facade.service.spec.ts
pnpm exec jest \
  --config libs/portal/stalker/data-access/jest.config.ts \
  --runInBand \
  libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-series.feature.spec.ts
! rg -n \
  'is_series\s*===|String\(.*is_series|!selectedItem\.is_series' \
  libs/portal/stalker
```

Expected: both Jest commands and the negated `rg` check pass; no raw
series-flag decisions remain. Logging and value-preserving serialization may
still mention `is_series`.

- [ ] **Step 6: Commit the normalized flag contract**

```bash
git add \
  libs/portal/stalker/feature/src/lib/stalker-catalog-facade.service.spec.ts \
  libs/portal/stalker/feature/src/lib/stalker-catalog-facade.service.ts \
  libs/portal/stalker/feature/src/lib/stalker-catalog-detail/stalker-catalog-detail.component.ts \
  libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-series.feature.spec.ts \
  libs/portal/stalker/data-access/src/lib/stores/features/with-stalker-series.feature.ts
git commit -m "fix(stalker): normalize catalog series flags"
```

### Task 5: Give lazy VOD-series episodes parent-scoped identities

**Files:**
- Modify: `libs/portal/stalker/data-access/src/lib/stalker-series.adapters.spec.ts`
- Modify: `libs/portal/stalker/data-access/src/lib/stalker-series.adapters.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`

- [ ] **Step 1: Replace the old identity test with collision regressions**

Extend the local episode metadata type:

```ts
type EpisodeWithMetadata = {
    custom_sid?: string;
    id?: string;
    legacyTrackingId?: number;
    originalId?: string;
    originalCmd?: string;
};
```

Update every `mapVodSeriesEpisodes` call to pass an options object. Add tests
which prove:

1. the same parent, provider episode, season, and episode number are
   deterministic;
2. the same season/episode in parent series `100` and `200` produces different
   `id` values;
3. those two episodes retain the same `legacyTrackingId`;
4. two provider episode IDs within one parent also produce different IDs; and
5. `mapRegularSeriesEpisodes` keeps its existing identity behavior.

Representative calls:

```ts
const firstSeries = mapVodSeriesEpisodes(seasons, {
    parentSeriesId: 100,
    fallbackPoster: 'poster.jpg',
});
const secondSeries = mapVodSeriesEpisodes(seasons, {
    parentSeriesId: 200,
    fallbackPoster: 'poster.jpg',
});
```

- [ ] **Step 2: Run the adapter spec and verify RED**

Run:

```bash
pnpm exec jest \
  --config libs/portal/stalker/data-access/jest.config.ts \
  --runInBand \
  libs/portal/stalker/data-access/src/lib/stalker-series.adapters.spec.ts
```

Expected: FAIL because the current adapter has no options object or
`legacyTrackingId`, and identical season/episode pairs collide across parents.

- [ ] **Step 3: Add an explicit mapping contract**

In `stalker-series.adapters.ts`, add:

```ts
export interface MapVodSeriesEpisodesOptions {
    parentSeriesId: string | number;
    fallbackPoster?: string;
}

export interface StalkerMappedEpisode extends XtreamSerieEpisode {
    legacyTrackingId?: number;
    originalId?: string;
    originalCmd?: string;
}
```

Replace the VOD branch of `generateEpisodeId` with two named helpers:

```ts
function generateLegacyVodEpisodeId(
    episodeNum: number,
    seasonKey: string
): number {
    return hashString(`vod_${seasonKey}_${episodeNum}`);
}

function generateVodEpisodeId(options: {
    parentSeriesId: string | number;
    providerEpisodeId: string;
    seasonKey: string;
    episodeNum: number;
}): number {
    return hashString(
        JSON.stringify([
            'vod',
            String(options.parentSeriesId),
            options.providerEpisodeId,
            options.seasonKey,
            options.episodeNum,
        ])
    );
}
```

Keep the regular-series `generateEpisodeId` path unchanged. Change the public
signature to:

```ts
export function mapVodSeriesEpisodes(
    seasons: ReadonlyArray<VodSeriesSeasonVm>,
    options: MapVodSeriesEpisodesOptions
): Record<string, XtreamSerieEpisode[]>
```

For every VOD episode, set:

```ts
const providerEpisodeId = String(episode.id ?? '');
const legacyTrackingId = generateLegacyVodEpisodeId(
    episodeNum,
    seasonKey
);
const trackingId = generateVodEpisodeId({
    parentSeriesId: options.parentSeriesId,
    providerEpisodeId,
    seasonKey,
    episodeNum,
});
```

Use `options.fallbackPoster` for the fallback artwork and expose both
`originalId: providerEpisodeId` and `legacyTrackingId` on the mapped episode.

- [ ] **Step 4: Pass the selected parent identity at the only production call**

In `StalkerSeriesViewComponent.mappedSeasons`, capture `displayItem` once and
call:

```ts
mapVodSeriesEpisodes(this.vodSeriesSeasons(), {
    parentSeriesId: this.toSeriesId(displayItem?.id ?? 0),
    fallbackPoster: displayItem?.info?.movie_image,
})
```

Do not derive the parent from a season or episode field; the selected catalog
item, normalized through the same `toSeriesId` path used by persistence, is the
scope represented by `seriesXtreamId`.

- [ ] **Step 5: Run the adapter spec and verify GREEN**

Run:

```bash
pnpm exec jest \
  --config libs/portal/stalker/data-access/jest.config.ts \
  --runInBand \
  libs/portal/stalker/data-access/src/lib/stalker-series.adapters.spec.ts
```

Expected: all scoped-identity and legacy-ID cases pass.

Do not commit yet. Task 6 wires legacy reconciliation in the same atomic
behavior commit so a scoped-ID build can never ship without resume
compatibility.

### Task 6: Reconcile and migrate legacy Stalker playback positions

**Files:**
- Create: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.spec.ts`
- Create: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.position-compatibility.spec.ts`
- Verify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.spec.ts`
- Modify: `libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts`
- Include uncommitted Task 5 changes in:
  `libs/portal/stalker/data-access/src/lib/stalker-series.adapters.spec.ts`
- Include uncommitted Task 5 changes in:
  `libs/portal/stalker/data-access/src/lib/stalker-series.adapters.ts`

- [ ] **Step 1: Add failing pure reconciliation tests**

Create the compatibility spec and cover these cases:

1. an exact new ID wins when both new and legacy rows exist, while the
   compatible legacy row remains available only as cleanup metadata;
2. a legacy row from the current `seriesXtreamId` becomes an alias under the
   new ID;
3. a row with a different parent series is ignored;
4. present `seasonNumber` or `episodeNumber` values must match the mapped
   episode, while absent legacy metadata remains compatible;
5. episodes without `legacyTrackingId` never receive an alias;
6. saving a migrated position awaits the new save before clearing the old ID;
7. a rejected save never clears the old row;
8. save and clear helpers reject legacy cleanup for a different/missing
   parent, equal old/new IDs, non-episode content, or conflicting playlist; and
9. clearing an exact scoped row clears its confirmed legacy ID before the
   scoped ID, after which a fresh reconciliation cannot resurrect progress;
10. a rejected legacy clear leaves the exact scoped row untouched, while a
    scoped-clear failure after legacy cleanup also leaves exact progress
    available.

Use fixtures with two parent series that share a legacy tracking ID. Assert
call order with an array pushed by the repository mocks rather than relying
only on invocation counts.

- [ ] **Step 2: Run the new spec and verify RED**

Run:

```bash
pnpm exec jest \
  --config libs/portal/stalker/feature/jest.config.ts \
  --runInBand \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.spec.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure compatibility boundary**

Export:

```ts
export interface ReconciledStalkerSeriesPositions {
    positionsByTrackingId: Map<number, PlaybackPositionData>;
    legacyPositionByTrackingId: Map<number, PlaybackPositionData>;
}

export function reconcileStalkerSeriesPositions(options: {
    seriesXtreamId: number;
    episodesBySeason: Readonly<
        Record<string, readonly XtreamSerieEpisode[]>
    >;
    seriesPositions: readonly PlaybackPositionData[];
}): ReconciledStalkerSeriesPositions;

export async function saveStalkerSeriesPosition(options: {
    repository: Pick<
        PortalPlaybackPositions,
        'savePlaybackPosition' | 'clearPlaybackPosition'
    >;
    playlistId: string;
    position: PlaybackPositionData;
    legacyPosition?: PlaybackPositionData;
}): Promise<boolean>;

export async function clearStalkerSeriesPosition(options: {
    repository: Pick<PortalPlaybackPositions, 'clearPlaybackPosition'>;
    playlistId: string;
    position: PlaybackPositionData;
    legacyPosition?: PlaybackPositionData;
}): Promise<boolean>;
```

`reconcileStalkerSeriesPositions` must:

- index only `contentType: 'episode'` rows whose `seriesXtreamId` equals the
  requested parent;
- receive those rows only from
  `getSeriesPlaybackPositions(playlistId, seriesXtreamId)`; never broaden the
  migration with `getAllPlaybackPositions`;
- preserve exact current-ID rows first;
- inspect `legacyTrackingId` only on `StalkerMappedEpisode`;
- require a present legacy `seasonNumber` and/or `episodeNumber` to equal the
  mapped episode (`null`/`undefined` means absent; compare other runtime values
  numerically);
- inspect a compatible legacy row even when an exact scoped row already won;
- record that original legacy row in `legacyPositionByTrackingId`, keyed by
  the new tracking ID, so exact-row save/clear operations can remove it; and
- only when no exact row exists, clone the compatible legacy row under the new
  ID, setting the current parent, season, and episode metadata without mutating
  the source row.

Factor one private ownership predicate shared by both persistence helpers.
`saveStalkerSeriesPosition` must always await the new save first. It clears the
legacy row and returns `true` only when all of these hold:

```ts
position.contentType === 'episode'
legacyPosition?.contentType === 'episode'
position.contentXtreamId !== legacyPosition.contentXtreamId
position.seriesXtreamId != null
legacyPosition.seriesXtreamId != null
position.seriesXtreamId === legacyPosition.seriesXtreamId
(!position.playlistId || position.playlistId === playlistId)
(!legacyPosition.playlistId || legacyPosition.playlistId === playlistId)
```

Otherwise it returns `false` after saving the new row. Let save/clear failures
reject so callers cannot mistake a partial migration for success.

When the same ownership predicate confirms a distinct legacy row,
`clearStalkerSeriesPosition` must clear the legacy ID first and the scoped
`position.contentXtreamId` second, then return `true`. This ordering is
load-bearing: if legacy cleanup fails, the exact row remains; if scoped cleanup
then fails, the exact row still represents the uncleared state and the legacy
row cannot resurrect. Without a confirmed legacy row, clear only the scoped ID
and return `false`. Tests should back repository rows with a `Map`, remove rows
in the mock, and rerun reconciliation after a dual clear.

- [ ] **Step 4: Run the pure compatibility spec and verify GREEN**

Run:

```bash
pnpm exec jest \
  --config libs/portal/stalker/feature/jest.config.ts \
  --runInBand \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.spec.ts
```

Expected: all reconciliation, guard, and save-before-clear tests pass.

- [ ] **Step 5: Add failing component integration regressions in a focused spec**

Create `stalker-series-view.position-compatibility.spec.ts` with the smallest
TestBed harness needed for position loading, lazy episodes, time updates, and
toggle requests. Do not append these cases to
`stalker-series-view.component.spec.ts`: it is already close to the 1200-line
test ceiling. Prove:

- positions returned before lazy episodes load are reconciled after
  `loadEpisodesForSeason` populates the season;
- an exact scoped position beats a compatible legacy row but retains that
  legacy row as cleanup metadata;
- a slow response for series A cannot overwrite positions after selection
  changes to series B;
- inline time updates and watched toggles save the scoped ID and then clear a
  confirmed legacy ID;
- after an exact or migrated save, an effect/reconciliation rerun does not
  restore the removed legacy alias from raw rows;
- clearing a scoped watched state also clears its confirmed legacy row, and a
  reload/reconciliation does not make the old progress reappear; and
- no legacy clear occurs for regular series or an unconfirmed legacy alias.

Use deferred promises for the stale-response case. Instantiate the real
component with its injected repository/store mocks so the signals and effects,
not only the pure helper, are exercised.

- [ ] **Step 6: Run the component spec and verify RED**

Run:

```bash
pnpm exec jest \
  --config libs/portal/stalker/feature/jest.config.ts \
  --runInBand \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.position-compatibility.spec.ts
```

Expected: the lazy reconciliation, stale-response, and migration assertions
fail against the current single map/direct-save implementation.

- [ ] **Step 7: Store raw rows separately and reconcile whenever episodes change**

In `StalkerSeriesViewComponent`, add:

```ts
private readonly rawSeriesPositions =
    signal<readonly PlaybackPositionData[]>([]);
private readonly legacyPositionByTrackingId =
    signal<Map<number, PlaybackPositionData>>(new Map());
private seriesPositionsLoadGeneration = 0;
```

Add one effect that reads `displayItem`, `mappedSeasons`, and
`rawSeriesPositions`, calls `reconcileStalkerSeriesPositions`, then updates
`episodePlaybackPositions` and `legacyPositionByTrackingId`. Clear all three
position stores when no playlist/series is selected.

Refactor `loadSeriesPositions` to capture a monotonically increasing
generation plus the requested playlist/series IDs. After the await, publish
the raw rows only if:

- the generation is still current;
- the current playlist ID still matches; and
- `toSeriesId(displayItem()?.id)` still matches.

This makes a lazy episode load naturally re-run reconciliation and prevents
detail-to-detail races from publishing stale rows.

- [ ] **Step 8: Route position writes through the migration helper**

Keep policy and ownership checks in the new helper so the already-baselined
production component gains only signal/effect wiring and thin repository
coordination.

Add a private method that calls `saveStalkerSeriesPosition` with the legacy row
looked up by the new `contentXtreamId`, whether the rendered value came from a
legacy fallback or an already-exact scoped row. On successful save:

- filter both the scoped ID and the confirmed legacy
  `contentXtreamId` from `rawSeriesPositions`, then append the saved scoped
  row;
- remove the consumed legacy alias from
  `legacyPositionByTrackingId`; and
- update the rendered map immediately.

Use this method from:

- throttled inline time updates;
- `handlePlaybackToggleRequested` when `nextPosition` is present; and
- matching runtime bridge updates.

The runtime bridge path intentionally repeats the facade's idempotent upsert:
only the series view has the episode mapping needed to order “save scoped row,
then clear confirmed legacy row.”

For a clear toggle, call `clearStalkerSeriesPosition`, then remove both
confirmed rows from raw/rendered state. Propagate either clear failure rather
than publishing a false success. Never infer a legacy ID from season/episode
numbers at write time; only the reconciliation result may authorize deletion.
The focused component spec must force reconciliation after a successful save
and refetch/reconcile after a successful dual clear to prove the legacy row
cannot reappear.

- [ ] **Step 9: Run all affected Stalker unit tests**

Run:

```bash
pnpm nx test portal-stalker-data-access --runInBand
pnpm nx test portal-stalker-feature --runInBand
```

Expected: both projects pass, including all flag, ID, reconciliation, lazy-load,
and migration regressions.

- [ ] **Step 10: Commit scoped identity and legacy migration atomically**

```bash
git add \
  libs/portal/stalker/data-access/src/lib/stalker-series.adapters.spec.ts \
  libs/portal/stalker/data-access/src/lib/stalker-series.adapters.ts \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.spec.ts \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-position-compatibility.ts \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.position-compatibility.spec.ts \
  libs/portal/stalker/feature/src/lib/stalker-series-view/stalker-series-view.component.ts
git commit -m "fix(stalker): preserve progress with scoped episode IDs"
```

### Task 7: Publish the Stalker compatibility contract

**Files:**
- Create: `.changes/stalker-series-position-identity.md`
- Modify: `docs/architecture/stalker-portal.md`
- Modify: `CLAUDE.md`
- Modify: `libs/shared/interfaces/src/lib/stalker-item.normalizer.spec.ts`
- Modify: `libs/shared/interfaces/src/lib/stalker-item.normalizer.ts`

- [ ] **Step 1: Add the required user-facing release note**

Create:

```markdown
---
type: fix
area: stalker
---

Stalker VOD series now report progress correctly when portals return boolean series flags, keep episode progress separate between shows, and resume positions saved by earlier versions.
```

- [ ] **Step 2: Lock the shared normalizer contract**

In `stalker-item.normalizer.spec.ts`, add parameterized assertions that
`extractStalkerItemType` classifies `is_series: true`, `1`, and `'1'` as
series. Update the normalizer's “truthy” doc comment to name those exact shapes.
This is contract coverage/documentation for the already-correct shared
normalizer; do not duplicate the feature fix in `shared-interfaces`.

Run:

```bash
pnpm nx test shared-interfaces --runInBand
```

Expected: PASS.

- [ ] **Step 3: Document scoped episode identity and migration**

In `docs/architecture/stalker-portal.md`, update the VOD-series and playback
position sections to state:

- `is_series` is normalized only from `true`, `1`, or `'1'`;
- lazy VOD-series tracking IDs include parent series ID, provider episode ID,
  season key, and episode number;
- the previous season/episode hash is exposed only as a compatibility alias;
- legacy rows are considered only inside the current parent-series query and
  must satisfy any stored season/episode metadata;
- exact scoped rows win;
- the new row is saved before a confirmed legacy row is removed; and
- no database schema migration or bulk rewrite is performed.

Add the compatibility helper, pure spec, and focused component integration spec
to the regression-coverage file inventory.

- [ ] **Step 4: Keep the root architecture summary current**

Update the Stalker series entry in `CLAUDE.md` with the same concise identity
and migration rule. Do not add this implementation detail to `AGENTS.md`; its
process guidance is unaffected.

- [ ] **Step 5: Validate docs and the note**

Run:

```bash
pnpm run release:notes:validate
pnpm nx test shared-interfaces --runInBand
git diff --check
```

Expected: all commands pass.

- [ ] **Step 6: Commit the Stalker docs and release note**

```bash
git add \
  .changes/stalker-series-position-identity.md \
  docs/architecture/stalker-portal.md \
  CLAUDE.md \
  libs/shared/interfaces/src/lib/stalker-item.normalizer.spec.ts \
  libs/shared/interfaces/src/lib/stalker-item.normalizer.ts
git commit -m "docs(stalker): record series position compatibility"
```

### Task 8: Add mechanical validation for committed repository skills

**Files:**
- Create: `tools/skills/validate-repository-skills.test.mjs`
- Create: `tools/skills/validate-repository-skills.mjs`
- Create: `tools/skills/project.json`
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write validator tests against temporary repositories**

Export a `validateRepositorySkills({ rootDir })` function so the tests can use
isolated fixtures. Build one valid temporary repository per test with
`node:fs/promises` and `mkdtemp`, then assert diagnostics for:

1. a valid trigger-only skill whose quoted description contains a YAML
   colon-space value such as `type: internal`;
2. a frontmatter `name` that differs from its directory;
3. a description that does not start with `Use when`;
4. a description over 500 characters;
5. a skill over 500 words;
6. a backticked, literal repository path that does not exist; and
7. byte-different `.codex` / `.claude` release mirrors.

The valid fixture must prove that wildcard/placeholder examples such as
`apps/*-e2e` and `libs/<domain>/feature` are skipped by path validation.

- [ ] **Step 2: Run the validator tests and verify RED**

Run:

```bash
node --test tools/skills/validate-repository-skills.test.mjs
```

Expected: FAIL because the validator module does not exist.

- [ ] **Step 3: Implement the dependency-free validator**

`validateRepositorySkills` must:

- discover direct `.codex/skills/*/SKILL.md` files in sorted order;
- parse the opening `---` frontmatter without adding a YAML dependency,
  unquoting matching single- or double-quoted one-line scalar values before
  validation;
- require `name` to equal the containing directory;
- require a one-line `description` that begins with `Use when` and is at most
  500 characters;
- count Markdown words and reject a complete skill over 500 words;
- inspect backticked tokens beginning with `apps/`, `libs/`, `docs/`, `tools/`,
  `.changes/`, or `.github/`, plus tokens exactly equal to `package.json`,
  `pnpm-lock.yaml`, `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`,
  `CHANGELOG.md`, `AGENTS.md`, or `CLAUDE.md`;
- skip tokens containing glob or placeholder characters (`*`, `?`, `[`, `]`,
  `{`, `}`, `<`, `>`) and require every remaining literal path to exist;
- compare the `release-notes` and `release-cut` `.codex` files byte-for-byte
  with their `.claude` mirrors; and
- return all diagnostics in deterministic order instead of failing at the
  first error.

The CLI entrypoint prints one diagnostic per line to stderr and sets a nonzero
exit code. A valid run prints the number of checked skills. Guard CLI execution
with `fileURLToPath(import.meta.url)` so importing the module in `node:test`
never runs the repository-root validation as a side effect.

- [ ] **Step 4: Add an Nx project and package entrypoint**

Create `tools/skills/project.json`:

```json
{
    "name": "repository-skills",
    "$schema": "../../node_modules/nx/schemas/project-schema.json",
    "projectType": "library",
    "sourceRoot": "tools/skills",
    "tags": ["scope:tools", "domain:skills", "type:tool"],
    "targets": {
        "test": {
            "executor": "nx:run-commands",
            "cache": true,
            "inputs": [
                "{workspaceRoot}/tools/skills/validate-repository-skills.mjs",
                "{workspaceRoot}/tools/skills/validate-repository-skills.test.mjs"
            ],
            "options": {
                "command": "node --test tools/skills/validate-repository-skills.test.mjs",
                "cwd": "{workspaceRoot}"
            }
        },
        "lint": {
            "executor": "nx:run-commands",
            "options": {
                "command": "node --check tools/skills/validate-repository-skills.mjs",
                "cwd": "{workspaceRoot}"
            }
        }
    }
}
```

Add:

```json
"skills:validate": "node tools/skills/validate-repository-skills.mjs"
```

to `package.json` scripts without reordering unrelated scripts.

- [ ] **Step 5: Run the test suite and verify GREEN**

Run:

```bash
node --test tools/skills/validate-repository-skills.test.mjs
pnpm nx show project repository-skills
pnpm nx test repository-skills
```

Expected: the unit suite passes and Nx discovers the tagged tool project.
`pnpm run skills:validate` is intentionally deferred until Tasks 9-10 make the
current eight skills comply.

- [ ] **Step 6: Document the maintenance hook and refresh the skill inventory**

Merge these exact maintenance bullets into the existing Agent Bootstrap/process
section in both `AGENTS.md` and `CLAUDE.md`; keep the shared wording identical:

```markdown
- Repository-specific skills live under `.codex/skills/`.
- Frontmatter descriptions are trigger-only and begin with `Use when`; keep
  each skill at or below 500 words.
- Run `pnpm run skills:validate` after editing a committed skill or a literal
  path it documents.
- Keep `.codex` and `.claude` copies of `release-notes` and `release-cut`
  byte-identical.
```

Then replace the stale six-entry `AGENTS.md` `## Repo Skills` inventory with
paths only for all eight committed skills:

```markdown
## Repo Skills

- `.codex/skills/iptvnator-nx-architecture/SKILL.md`
- `.codex/skills/iptvnator-sqlite-db-worker/SKILL.md`
- `.codex/skills/iptvnator-theme-style/SKILL.md`
- `.codex/skills/iptvnator-ui-design/SKILL.md`
- `.codex/skills/release-cut/SKILL.md`
- `.codex/skills/release-notes/SKILL.md`
- `.codex/skills/stalker-portal/SKILL.md`
- `.codex/skills/xtream-electron/SKILL.md`

Descriptions and trigger conditions are canonical in each skill's frontmatter;
do not duplicate them here.
```

- [ ] **Step 7: Commit the validator**

```bash
git add \
  tools/skills/validate-repository-skills.test.mjs \
  tools/skills/validate-repository-skills.mjs \
  tools/skills/project.json \
  package.json \
  AGENTS.md \
  CLAUDE.md
git commit -m "test(skills): validate repository skill contracts"
```

### Task 9: Refresh the Nx and SQLite ownership skills

**Files:**
- Modify: `.codex/skills/iptvnator-nx-architecture/SKILL.md`
- Modify: `.codex/skills/iptvnator-sqlite-db-worker/SKILL.md`
- Modify: `docs/architecture/nx-workspace-boundaries.md`
- Modify: `docs/architecture/sqlite-db-worker.md`

- [ ] **Step 1: Replace both frontmatter descriptions with trigger-only text**

Use exactly:

```yaml
description: Use when deciding where IPTVnator code belongs, creating or moving Nx projects, changing scoped aliases or tags, editing lint targets, or validating module boundaries.
```

and:

```yaml
description: Use when changing Electron SQLite IPC, database-worker operations, request-scoped progress or cancellation, worker packaging, or runtime verification of non-EPG database work.
```

Remove the duplicate “Use this skill when…” sentence from each body.

- [ ] **Step 2: Rewrite the Nx skill around decisions, not a stale inventory**

Keep it below 500 words and include these exact contracts:

- bootstrap with `pnpm install --frozen-lockfile`, then discover reality with
  `pnpm nx show projects`, `pnpm nx show project <name>`, and the two
  `--withTarget test|e2e` queries;
- current app groups: `web`, `electron-backend`, `web-backend`,
  `remote-control-web`, `website`, both E2E apps, and both provider mock
  servers; current tool groups: ESLint, packaging, release, and repository
  skills; discovery remains authoritative when this snapshot changes;
- use `apps/` for runtime/dev/E2E/mock apps, `tools/` for repo automation, and
  domain libraries under `libs/`;
- `type:feature` owns route and screen orchestration, `type:ui` reusable visual
  components, `type:data-access` injectable state/API/persistence/orchestration,
  and `type:util` pure code only;
- provider-neutral collection services that coordinate persistence belong in
  `libs/portal/shared/data-access`; pure helpers stay in
  `libs/portal/shared/util`; reusable views stay in
  `libs/portal/shared/ui`;
- every project keeps one `scope:*`, `domain:*`, and `type:*` tag; reproduce
  the full enforced type direction from `eslint.config.mjs`: app/E2E/dev-app →
  feature/UI/data-access/util, website → UI/util, feature →
  feature/UI/data-access/util, UI → UI/data-access/util, data-access →
  data-access/util, and util → util;
- domain constraints remain additive to type constraints; do not weaken them
  to solve a placement problem, and preserve the `workspace-shell-util`
  path/tag exception documented in the canonical architecture guide;
- aliases come from `tsconfig.base.json`, public imports go through
  `src/index.ts`, and a buildable library's `package.json.name` matches its
  scoped alias;
- production TypeScript targets under 300 lines with a hard 400 maximum, tests
  under 1200, and the legacy baseline may only shrink;
- command-based lint targets quote recursive globs, followed by a file-count
  comparison; and
- validation is target-aware: run affected lint/test/build and the closest E2E
  instead of inventing targets.

Link `docs/architecture/nx-workspace-boundaries.md`,
`tools/eslint/max-lines-config.mjs`, and
`tools/eslint/generate-max-lines-baseline.mjs`.

- [ ] **Step 3: Bring the Nx architecture doc up to the same contract**

Add sections for:

- the `apps` / `libs` / `tools` placement decision;
- `scope:tools` for repository automation projects, matching existing tool
  projects;
- `type:data-access` versus `type:util` using the portal collection example;
- max-lines ownership and the “baseline only shrinks” rule;
- quoted `eslint "apps/<project>/**/*.ts"` run-command globs and the
  `find ... -name '*.ts' | wc -l` comparison; and
- target discovery before choosing validation commands.

Do not hard-code an exhaustive project list that will drift; commands are the
canonical inventory.

- [ ] **Step 4: Rewrite the SQLite skill around the actual protocol**

Keep it below 500 words and include:

- ownership paths for the client, protocol, dispatcher, worker connection,
  runtime paths, operation modules, build script, preload API, and canonical
  architecture doc;
- the three bundles produced by
  `apps/electron-backend/build-worker.js`: EPG parser, database, and playlist
  refresh;
- `requestId` is generated per client request and correlates worker
  event/response transport; `operationId` is a renderer-visible long-operation
  identity used for progress and cooperative cancellation;
- current tracked operations are save content, delete Xtream content, restore
  Xtream user data, delete playlist, and delete all playlists;
- the first four are cancellable; delete-all-playlists is deliberately tracked
  with `cancellable: false`;
- already committed chunks stay committed, final cancellation is an
  `AbortError`, and only the terminal event settles UI state;
- SQL-heavy work stays in operation modules; the dispatcher remains thin;
- EPG parsing remains in its dedicated worker, while lightweight
  download/EPG-specific main-process handlers are not silently migrated as part
  of unrelated DB work;
- `.run()` is mandatory for prepared writes inside synchronous
  `better-sqlite3` transactions;
- after source changes, run `pnpm nx run electron-backend:build-worker`, verify
  the `dist` artifact timestamp, restart Electron, then perform CDP/E2E; and
- use `IPTVNATOR_TRACE_DB=1` / `IPTVNATOR_TRACE_SQL=1` only through redacting
  logging paths.

- [ ] **Step 5: Correct stale SQLite architecture inventory**

In `docs/architecture/sqlite-db-worker.md`:

- add `title-sources.operations.ts`, `vod-source-pin.operations.ts`, and the
  content-search/token helper modules to the operation inventory;
- replace the stale collection-service paths under
  `libs/portal/shared/util` with their actual
  `libs/portal/shared/data-access` ownership;
- distinguish `requestId` from `operationId` next to the message contract;
- list the four cancellable operations and the non-cancellable tracked
  delete-all operation explicitly;
- change “bundles both” to all three build outputs, including
  `playlist-refresh.worker.ts/.js`; keep the packaged-verifier subsection
  accurate that `workerFiles` currently checks the EPG parser and database
  bundles rather than claiming a third explicit check that is not implemented;
- retain the documented worker rebuild/restart rule and direct-main-thread
  exceptions; and
- remove “first cut” wording that implies cancellation or the core portal
  migration is still pending.

- [ ] **Step 6: Validate both refreshed skills and docs**

Run:

```bash
pnpm nx test repository-skills
pnpm nx lint repository-skills
rg -n '^description: Use when ' \
  .codex/skills/iptvnator-nx-architecture/SKILL.md \
  .codex/skills/iptvnator-sqlite-db-worker/SKILL.md
wc -w \
  .codex/skills/iptvnator-nx-architecture/SKILL.md \
  .codex/skills/iptvnator-sqlite-db-worker/SKILL.md
! rg -n 'bundles both' \
  .codex/skills/iptvnator-sqlite-db-worker/SKILL.md \
  docs/architecture/sqlite-db-worker.md
rg -n \
  'requestId.*operationId|operationId.*requestId|playlist-refresh' \
  .codex/skills/iptvnator-sqlite-db-worker/SKILL.md \
  docs/architecture/sqlite-db-worker.md
git diff --check
```

Expected: validator unit/lint targets and the negated stale-phrase check pass;
both descriptions are found, each reported word count is at most 500, and both
identifiers plus the playlist-refresh worker are found in current guidance.
The repository-wide `skills:validate` run remains deferred until Task 10 has
refreshed the other four non-release skills.

- [ ] **Step 7: Commit Nx and SQLite guidance**

```bash
git add \
  .codex/skills/iptvnator-nx-architecture/SKILL.md \
  .codex/skills/iptvnator-sqlite-db-worker/SKILL.md \
  docs/architecture/nx-workspace-boundaries.md \
  docs/architecture/sqlite-db-worker.md
git commit -m "docs(skills): refresh Nx and SQLite ownership"
```

### Task 10: Refresh theme, UI, Stalker, and Xtream skills

**Files:**
- Modify: `.codex/skills/iptvnator-theme-style/SKILL.md`
- Modify: `.codex/skills/iptvnator-ui-design/SKILL.md`
- Modify: `.codex/skills/stalker-portal/SKILL.md`
- Modify: `.codex/skills/xtream-electron/SKILL.md`
- Modify: `libs/ui/styles/_index.scss`
- Modify: `docs/architecture/iptvnator-ui-guidelines.md`
- Modify: `docs/architecture/stalker-epg.md`
- Modify: `docs/architecture/stalker-portal.md`
- Modify: `docs/architecture/xtream-portal-compatibility.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace all four descriptions with trigger-only text**

Use exactly:

```yaml
description: Use when changing IPTVnator SCSS tokens, shared layout mixins, portal headers, sidebars, detail views, Electron drag regions, or cross-portal visual consistency.
```

```yaml
description: Use when changing user-visible Angular UI in IPTVnator, especially channel rows or lists, EPG views, settings and playlist surfaces, selection states, shared portal components, or light/dark styling.
```

```yaml
description: Use when changing Stalker or Ministra routes, stores, catalog or series shapes, playback progress, favorites and recent items, EPG, or remote control.
```

```yaml
description: Use when changing Xtream routes, Signal Store or data sources, content identity, SQLite-backed import, search or delete, sparse VOD playback, or Electron and PWA behavior.
```

Remove each body's duplicate trigger paragraph.

- [ ] **Step 2: Rewrite the theme skill to match the emitted-token boundary**

Keep it below 500 words and include:

- canonical sources under `apps/web/src/m3-theme.scss`, `libs/ui/styles/`, and
  `docs/architecture/iptvnator-ui-guidelines.md`;
- app-owned surfaces, text, selection, separators, hover, and provider accents
  use `--app-*` tokens, including `--app-selection-on-color` for selected
  foregrounds;
- Angular Material theme mixins and Material component overrides may use their
  Material tokens;
- a `--mat-sys-*` token outside a Material-owned component is acceptable only
  after proving it is emitted in both theme contexts and providing an
  app-token or literal fallback;
- semantic status colors may be local, but existing hard-coded layout,
  selection, and EPG surface colors are migration debt, not examples to copy;
- `libs/ui/styles/_index.scss` is a forwarding inventory, not a configured
  global Sass load path; current consumers use relative `@use` paths;
- extract repeated layout into the canonical shared partial, while
  provider-shared service/UI styles use the existing forwarding modules rather
  than copied SCSS;
- Electron draggable containers explicitly give buttons, links, inputs,
  overlays, and resize handles `app-region: no-drag`; and
- inspect light/dark plus Xtream/Stalker/M3U/workspace consumers when a shared
  pattern changes.

- [ ] **Step 3: Rewrite the UI skill around shared ownership and flexible sizing**

Keep it below 500 words and include:

- inspect `@iptvnator/ui/components`, `@iptvnator/ui/epg`,
  `@iptvnator/ui/playback`, `@iptvnator/ui/shared-portals`,
  `@iptvnator/portal/shared/ui`, and `@iptvnator/playlist/shared/ui` before
  local markup;
- shared stateful collection orchestration belongs in
  `@iptvnator/portal/shared/data-access`, not UI or util;
- use app selection/surface/text tokens for app chrome in both themes and do
  not expand known hard-coded EPG/style debt;
- channel/list rows use minimum dimensions, flexible text columns, truncation,
  and trailing controls that do not resize the row; do not turn historical
  pixel examples into fixed layout contracts;
- preserve explicit scroll ownership, keyboard/focus state, empty/loading/error
  state, and the shared selection language;
- EPG uses shared timeline/list/panel components and provider layouts supply
  controlled data rather than duplicating them;
- visible changes require focused component coverage and the closest
  Playwright/CDP flow; and
- behavior-only work must avoid opportunistic visual rewrites.

- [ ] **Step 4: Correct the canonical UI guide and Sass forwarding comments**

In `docs/architecture/iptvnator-ui-guidelines.md`:

- replace the absolute claim that Material system surface tokens are never
  emitted with the scoped policy from Step 2;
- retain examples with explicit fallback, for example
  `var(--mat-sys-surface-container, var(--app-widget-bg))`;
- label current hard-coded non-semantic EPG/surface colors as debt;
- change exact row dimensions into current reference values plus flexible
  minimum-size/truncation requirements; and
- add the shared collection data-access ownership distinction.

In `libs/ui/styles/_index.scss`, remove the untrue instruction that consumers
can already rely on `stylePreprocessorOptions.includePaths`. Describe it as the
canonical forward list and show the relative `@use` pattern already used by
production consumers. Do not rewrite existing consumer imports in this task.

- [ ] **Step 5: Rewrite the Stalker skill around normalized shapes and scoped identity**

Keep it below 500 words and preserve links to
`docs/architecture/stalker-portal.md`, `docs/architecture/stalker-epg.md`, and
`docs/architecture/remote-control.md`. Include:

- provider API/session/normalization in Stalker data access, routed UI in
  feature, provider-neutral collection orchestration in portal shared
  data-access;
- normalize `is_series` from exactly `true`, `1`, and `'1'` across catalog,
  details, favorites/recent, dashboard classification, and lazy resources;
- preserve the three modes: regular `/series`, embedded VOD `series[]`, and
  lazy Ministra VOD series;
- lazy episode IDs are scoped by parent/provider/season/episode, with the old
  hash retained only as a guarded compatibility alias;
- exact scoped progress wins; legacy fallback is limited to the current parent
  and matching optional S/E metadata; save new before clearing confirmed old;
- playback metadata always carries parent `seriesXtreamId` plus resolved season
  and episode numbers;
- bulk ITV EPG eagerly starts once a category has channels, row previews read
  the cache, and only the active channel falls back to short EPG;
- radio skips EPG and keeps its live/audio collection identity; and
- targeted data-access, feature, dashboard, and closest E2E commands.

- [ ] **Step 6: Remove both contradictory Stalker EPG passages**

In `docs/architecture/stalker-epg.md`, replace “Before the first live-channel
playback, channel rows do not fetch EPG at all” with the actual eager flow:
once non-radio ITV channels render, the post-reset effect calls
`ensureBulkItvEpg(168)`; rows never issue per-row requests and derive previews
from the bulk cache. Keep the active-channel `get_short_epg` fallback
description unchanged. Make the matching correction in the EPG Integration
summary in `docs/architecture/stalker-portal.md`, removing its claims that row
previews have no pre-playback request and wait for the first active-channel
fetch.

- [ ] **Step 7: Rewrite the Xtream skill around capabilities and identities**

Keep it below 500 words and include:

- read `docs/architecture/xtream-portal-compatibility.md`,
  `docs/architecture/portal-detail-navigation.md`,
  `docs/architecture/vod-multi-source.md`, and
  `docs/architecture/sqlite-db-worker.md` before changing those contracts;
- `RuntimeCapabilitiesService.supportsXtreamSqliteDataSource`, not a generic
  Electron check, selects `ElectronXtreamDataSource`; otherwise use PWA;
- feature routes/screens live in portal Xtream feature, API/cache/stores/data
  sources in portal Xtream data-access, collection services plus reusable
  multi-source controllers/resolvers in portal shared data-access,
  screen-specific multi-source session/UI orchestration in the Xtream feature,
  reusable views in portal shared UI, and only pure contracts/helpers in portal
  shared util;
- content identity is playlist- and type-aware; never resolve a colliding
  live/movie/series ID by number alone, and distinguish normalized SQLite row
  IDs from provider `xtream_id` / `stream_id` / `series_id`;
- detail navigation carries enough route/provider identity to recover hidden
  categories and cross-portal links without sending a local DB ID to the API;
- sparse VOD metadata does not remove Play/Favorite/Download when an atomic
  positive stream-ID + extension pair can be recovered;
- multi-source is Electron-only Xtream↔Xtream movie behavior, capability-gated,
  owner-scoped, and must not combine partial source fields;
- current `XtreamStore` composition is portal, content, selection, search, EPG,
  player, favorites, recent items, and playback positions;
- large imports/search/delete/restore stay worker-backed with request-scoped
  progress and `operationId` cancellation;
- Xtream network/request cancellation follows the request or session identity
  used by the current data-source call (`requestId`/`sessionId` at those
  boundaries), while database long-operation progress/cancel uses
  `operationId`; never conflate the two; and
- validate both Electron and PWA data-source specs plus the relevant atomized
  target: `web-e2e:e2e-ci--src/xtream.e2e.ts`,
  `electron-backend-e2e:e2e-ci--src/xtream-responsiveness.e2e.ts`,
  `electron-backend-e2e:e2e-ci--src/xtream-vod-details.e2e.ts`, or
  `electron-backend-e2e:e2e-ci--src/vod-multi-source.e2e.ts`.

- [ ] **Step 8: Add the missing Xtream architecture links**

Add a short “Runtime selection and ownership” section to
`docs/architecture/xtream-portal-compatibility.md` covering the exact
`supportsXtreamSqliteDataSource` gate, shared data-access collection/multi-source
ownership, and type-aware playlist-scoped identity. Link to
`docs/architecture/nx-workspace-boundaries.md` and
`docs/architecture/sqlite-db-worker.md`.

Update the Xtream architecture summary in `CLAUDE.md` only where it still says
environment detection is a generic Electron/PWA branch or places collection
orchestration in util. Preserve the existing detailed sparse-VOD and
multi-source contracts.

- [ ] **Step 9: Validate the four skills and canonical docs**

Run:

```bash
pnpm run skills:validate
! rg -n \
  'Before the first live-channel playback|no pre-playback network requests|first active-channel fetch|stylePreprocessorOptions.includePaths' \
  docs/architecture/stalker-epg.md \
  docs/architecture/stalker-portal.md \
  libs/ui/styles/_index.scss
rg -n \
  'supportsXtreamSqliteDataSource|portal/shared/data-access|legacyTrackingId' \
  .codex/skills/xtream-electron/SKILL.md \
  .codex/skills/stalker-portal/SKILL.md \
  docs/architecture/xtream-portal-compatibility.md \
  docs/architecture/stalker-portal.md
git diff --check
```

Expected: the first `rg` has no matches; the second finds each current
contract; skill validation and whitespace checks pass.

- [ ] **Step 10: Commit the remaining skill and doc refresh**

```bash
git add \
  .codex/skills/iptvnator-theme-style/SKILL.md \
  .codex/skills/iptvnator-ui-design/SKILL.md \
  .codex/skills/stalker-portal/SKILL.md \
  .codex/skills/xtream-electron/SKILL.md \
  libs/ui/styles/_index.scss \
  docs/architecture/iptvnator-ui-guidelines.md \
  docs/architecture/stalker-epg.md \
  docs/architecture/stalker-portal.md \
  docs/architecture/xtream-portal-compatibility.md \
  CLAUDE.md
git commit -m "docs(skills): align provider and UI guidance"
```

### Task 11: Exercise every skill and run the final validation ladder

**Files:**
- Verify: `.codex/skills/*/SKILL.md`
- Verify: `.claude/skills/release-cut/SKILL.md`
- Verify: `.claude/skills/release-notes/SKILL.md`
- Verify: all files changed in Tasks 2-10

- [ ] **Step 1: Run eight fresh-context skill scenarios**

Use a fresh worker for each prompt with only the named skill and repository
available. Ask for a proposed approach, not code changes. A scenario passes
only if it independently reaches all listed decisions:

| Skill | Prompt | Required decisions |
|---|---|---|
| `iptvnator-nx-architecture` | Add a reusable Xtream/Stalker collection resolver that reads favorites and recent rows, with a new Nx project and command-based lint target. | `portal/shared/data-access`; three tags; scoped alias/public API; quoted recursive lint glob; target discovery and max-lines check. |
| `iptvnator-sqlite-db-worker` | Make `DB_DELETE_ALL_PLAYLISTS` cancellable using its request ID, then verify it in an already-running Electron app. | Reject both premises: delete-all is non-cancellable; cancellation uses `operationId`; distinguish transport `requestId`; rebuild worker and restart before runtime verification. |
| `iptvnator-theme-style` | Style a CDK overlay inside a draggable Electron header using a Material surface token and a short Sass import. | Prefer app surface token; require proof/fallback for external `--mat-sys-*`; use current relative Sass import; mark interactions no-drag; check both themes and shared consumers. |
| `iptvnator-ui-design` | Add a local fixed-size channel row and hard-coded selected EPG card to one portal. | Reuse shared row/EPG components; use app tokens; call hard-coded debt out; keep flexible minimum sizing/truncation; add interaction/theme coverage. |
| `release-notes` | A packaging verifier changed with no user-visible runtime effect and the release gate asks for a note. | Choose `internal` only if a note is desired/required, otherwise explain `no-release-note`; never call it a user fix; internal remains in changelog but not authored public body. |
| `release-cut` | Cut a patch release through remote `upstream`; the version's blog post already exists. | Edit existing post without force scaffolding; push exact branch/tag to named remote, never all tags; verify Pacman/source archive and other assets; identify automatic Docker and Snap-edge side effects plus manual promotion. |
| `stalker-portal` | A portal returns boolean `is_series`; two shows share S01E01; old progress must resume. | Use the normalizer; parent/provider/season/episode-scoped ID; current-parent legacy lookup with optional S/E guards; exact ID wins; save new before clear; test all surfaces. |
| `xtream-electron` | Live and movie rows share numeric ID, PWA has a partial bridge, a network request is replaced, and a global collection delete needs progress/cancel. | Capability-selected data source; playlist/type-aware identity; collection orchestration in shared data-access; no local DB ID sent to provider route; network request/session identity stays distinct from worker `operationId`; validate exact Electron/PWA and E2E paths. |

Record pass/fail notes in the task handoff. If a worker misses a required
decision, tighten that skill and rerun only its scenario until green.

- [ ] **Step 2: Commit any scenario-driven corrections**

Inspect the working tree after all eight scenarios:

```bash
git status --short
git diff --check
```

If a release scenario required tighter wording, apply the identical correction
to its `.claude` mirror and rerun that scenario before staging. Confirm the
pair first:

```bash
cmp -s \
  .codex/skills/release-cut/SKILL.md \
  .claude/skills/release-cut/SKILL.md
cmp -s \
  .codex/skills/release-notes/SKILL.md \
  .claude/skills/release-notes/SKILL.md
```

Then, if any scenario required tighter wording, stage only the reviewed skill,
mirror, root-process, and canonical-doc files from this task:

```bash
git add \
  .codex/skills/iptvnator-nx-architecture/SKILL.md \
  .codex/skills/iptvnator-sqlite-db-worker/SKILL.md \
  .codex/skills/iptvnator-theme-style/SKILL.md \
  .codex/skills/iptvnator-ui-design/SKILL.md \
  .codex/skills/release-cut/SKILL.md \
  .codex/skills/release-notes/SKILL.md \
  .codex/skills/stalker-portal/SKILL.md \
  .codex/skills/xtream-electron/SKILL.md \
  .claude/skills/release-cut/SKILL.md \
  .claude/skills/release-notes/SKILL.md \
  .changes/README.md \
  AGENTS.md \
  CLAUDE.md \
  libs/ui/styles/_index.scss \
  docs/architecture/nx-workspace-boundaries.md \
  docs/architecture/sqlite-db-worker.md \
  docs/architecture/iptvnator-ui-guidelines.md \
  docs/architecture/stalker-portal.md \
  docs/architecture/stalker-epg.md \
  docs/architecture/xtream-portal-compatibility.md
git diff --cached --name-only
```

If the staged diff is non-empty, commit it:

```bash
git commit -m "docs(skills): tighten validated guidance"
```

If no scenario changed a file, skip this commit. Do not leave scenario-driven
edits uncommitted for the final validation.

- [ ] **Step 3: Run structural and release validation**

Run:

```bash
pnpm run skills:validate
pnpm run release:notes:validate
node --test \
  tools/skills/validate-repository-skills.test.mjs \
  tools/release/release-notes.test.mjs \
  tools/release/release-note-gate.test.mjs \
  tools/release/build-release-notes.test.mjs \
  tools/release/screenshot-guards.test.mjs
cmp -s \
  .codex/skills/release-cut/SKILL.md \
  .claude/skills/release-cut/SKILL.md
cmp -s \
  .codex/skills/release-notes/SKILL.md \
  .claude/skills/release-notes/SKILL.md
```

Expected: all checks pass and both mirror comparisons exit 0.

- [ ] **Step 4: Run all directly affected unit projects**

Run:

```bash
pnpm nx test release-tools
pnpm nx test repository-skills
pnpm nx test shared-interfaces --runInBand
pnpm nx test portal-stalker-data-access --runInBand
pnpm nx test portal-stalker-feature --runInBand
pnpm nx test workspace-dashboard-data-access --runInBand
```

Expected: all six projects pass.

- [ ] **Step 5: Run affected lint and build targets**

Run:

```bash
pnpm nx run-many \
  --target=lint \
  --projects=release-tools,repository-skills,shared-interfaces,portal-stalker-data-access,portal-stalker-feature
pnpm nx build shared-interfaces
pnpm nx build web
pnpm nx build electron-backend
```

Expected: all lint targets and all three builds pass.

- [ ] **Step 6: Run the closest web and Electron user-workflow E2E**

Run:

```bash
pnpm nx run web-e2e:e2e-ci--src/stalker.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/recent.e2e.ts
```

Expected: the web Stalker catalog/series flow passes, and the Electron recent
suite exercises Stalker series persistence across an app restart. The
legacy-ID collision migration itself remains covered at pure-helper and
Angular component level because the current E2E fixtures cannot seed the old
colliding playback-position row before lazy episode mapping. State that
fixture limitation and the exact focused coverage in the final summary.

- [ ] **Step 7: Inspect the final diff for accidental scope**

Run:

```bash
git diff --check
git status --short
git diff --stat master...HEAD
git log --oneline --decorate master..HEAD
```

Confirm:

- exactly eight `.codex` skills were refreshed;
- only the two required `.claude` mirrors changed;
- no broad SCSS migration or database schema rewrite slipped in;
- the Stalker release note is the only new `.changes` note;
- AGENTS/CLAUDE shared process wording remains synchronized; and
- all implementation, tests, docs, and validation tooling are committed.

- [ ] **Step 8: Prepare the implementation handoff**

Report:

- behavior fixed (public internal-note filtering, Stalker flags/identity);
- skills and canonical docs updated;
- release note added;
- tests added/updated and every validation command with result;
- the E2E fixture limitation from Step 6; and
- the final commit list and clean working-tree status.
