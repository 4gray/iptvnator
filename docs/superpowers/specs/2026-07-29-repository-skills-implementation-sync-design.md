# Repository Skills and Implementation Synchronization Design

## Context

IPTVnator currently has eight repository-specific Codex skills under
`.codex/skills/`, with `release-cut` and `release-notes` mirrored under
`.claude/skills/`. A read-only audit found that their literal paths and most
high-level ownership rules remain valid, but several skills have drifted from
the implementation, canonical architecture documents, or current release
automation.

The audit also found two concrete Stalker defects:

1. catalog selection and progress handling bypass the shared `is_series`
   normalizer and therefore do not recognize boolean `true`;
2. lazy VOD-series episode tracking IDs omit the parent series identity, so two
   shows with the same season and episode coordinates can share one playback
   position key.

The release documentation states that `type: internal` notes are excluded from
the public GitHub release body. The tag workflow currently extracts the whole
CHANGELOG section, including the collapsed internal block, so the pipeline does
not honor that contract.

## Goals

1. Make every repository skill accurate enough to guide work in its declared
   area without contradicting current code or canonical documentation.
2. Convert every skill description into a trigger-only `Use when...` statement
   suitable for skill discovery.
3. Preserve byte-identical `.codex` and `.claude` release-skill mirrors.
4. Exclude `type: internal` notes from the public GitHub release body while
   retaining them in `CHANGELOG.md`.
5. Make Stalker `is_series` handling consistent for `true`, `1`, and `"1"`.
6. Scope lazy Stalker episode tracking IDs to the parent series without
   discarding playback progress saved with the legacy ID.
7. Synchronize the canonical documents touched by these contracts.
8. Add regression coverage and complete the repository's required validation
   ladder.

## Non-Goals

- Migrating every existing `--mat-sys-*` SCSS reference in one change.
- Redesigning IPTVnator UI or changing its visual language.
- Reworking the complete playback-position database schema.
- Replacing the Nx project layout or tag model.
- Changing Snap, Docker, or GitHub release automation beyond documenting their
  existing external effects and filtering public release text.
- Expanding VOD multi-source beyond its existing Xtream-movie/Electron scope.

## Change Areas

| Area | Primary files | Responsibility |
| --- | --- | --- |
| Release output | `tools/release/extract-changelog-section.mjs`, release tests, `.github/workflows/build-and-make.yaml` | Produce public release text without internal notes |
| Release guidance | `.codex/skills/release-*`, `.claude/skills/release-*`, `.changes/README.md` | Describe actual release behavior and safe execution |
| Stalker identity | `stalker-series.adapters.ts` and its spec | Generate series-scoped episode IDs and expose legacy identity |
| Stalker compatibility | `stalker-catalog-facade.service.ts` and specs | Use the shared `is_series` normalizer everywhere |
| Stalker progress migration | Stalker series view helpers/component and specs | Resolve and lazily migrate legacy playback-position IDs |
| Repository skills | all eight `.codex/skills/*/SKILL.md` files | Update triggers, ownership, invariants, and validation |
| Architecture docs | Stalker, SQLite worker, UI/theme, release documentation | Remove contradictions and record current contracts |
| Release note | one `.changes/stalker-*.md` file | Describe the user-visible Stalker progress fix |

## Release Body Design

`CHANGELOG.md` remains the complete release record. Its collapsed
`<details><summary>Internal changes</summary>...</details>` block is preserved.

`tools/release/extract-changelog-section.mjs` will gain an explicit public-body
mode:

- raw section extraction remains available for existing programmatic callers;
- the CLI accepts `--public`;
- public mode removes only the exact internal-details block emitted by
  `renderChangelogSection`;
- unrelated `<details>` blocks remain untouched;
- surrounding blank lines are normalized without rewriting note text;
- a release containing only internal notes may produce an empty authored body,
  after which GitHub's generated commit list remains available.

The tag workflow will invoke the extractor in public mode. Tests will cover a
mixed section, a public-only section, an internal-only section, and an unrelated
details block.

The release skills will also document that:

- publishing the GitHub release automatically triggers verified Snap upload to
  `edge`;
- candidate/stable Snap promotion remains manual;
- pushes to `master` and `v*` tags can publish Docker images;
- release pushes must name the intended remote, branch, and exact tag rather
  than using broad `git push --tags`;
- minor and patch releases have different blog-scaffolding paths;
- the asset checklist includes Pacman artifacts and
  `linux-frame-copy-runtime-sources.tar.xz`.

## Stalker `is_series` Design

All interpretation of a Stalker series flag will use
`isStalkerSeriesFlag(...)`. Catalog selection and progress classification will
not repeat local comparisons. Regression tests will cover boolean `true`,
numeric `1`, string `"1"`, and a non-series value.

This change is deliberately provider-local. Shared portal utilities remain
provider-neutral.

## Stalker Episode Identity and Compatibility

### New identity

`mapVodSeriesEpisodes(...)` will receive the parent series identity. The
generated tracking seed will include:

- parent series identity;
- provider episode identity;
- resolved season key;
- episode number.

The resulting numeric tracking ID remains deterministic for the same portal
record but no longer produces the same value merely because two different
shows both contain, for example, S01E01.

Each mapped lazy VOD-series episode will also carry its previous tracking ID as
`legacyTrackingId`. Regular Stalker series mapping is unchanged.

### Existing progress

When playback positions for the current series are loaded:

1. an exact new tracking-ID match wins;
2. otherwise, a position whose ID equals the episode's `legacyTrackingId` and
   whose `seriesXtreamId` matches the current parent is treated as that episode;
3. season/episode metadata is used as an additional guard when present;
4. the in-memory position is keyed by the new ID so quick start, badges, and
   playback controls behave normally;
5. the next successful position write saves the new ID before removing the
   confirmed legacy row.

Legacy rows are never deleted solely by coordinate or legacy ID. Parent-series
ownership must already have been established from the series-scoped position
query. This prevents migration from deleting another series' row.

Regression coverage will prove:

- two different parent series with identical episode coordinates receive
  different new IDs;
- repeated mapping of the same episode is stable;
- a legacy position resumes the matching new episode;
- an exact new position wins when both forms exist;
- a legacy row belonging to another parent is ignored;
- migration writes the new row before deleting the old row.

## Skill Synchronization Design

Every skill will remain concise and reference canonical documents for detail.
Descriptions will begin with `Use when...` and contain triggers only.

### Nx

`iptvnator-nx-architecture` will add the current app/tool shape, the complete
type-direction summary, domain-boundary awareness, path/tag exceptions,
buildable-package naming, target-aware validation discovery, max-lines policy,
and quoted lint-glob guardrail.

### SQLite worker

`iptvnator-sqlite-db-worker` will list the full ownership chain, distinguish
worker-backed heavy operations from intentionally small main-thread handlers,
name the cancellable-operation allowlist, explain `requestId` versus
`operationId`, and require worker rebuild plus Electron restart before runtime
verification. The architecture document's worker/module inventory will be
updated at the same time.

### Theme and UI

`iptvnator-theme-style` and `iptvnator-ui-design` will use `--app-*` tokens as
the application-surface and selection contract. Material component mixins and
component tokens remain valid for Material components. A `--mat-sys-*`
reference outside that boundary must be verified as emitted and have a real
fallback.

The skills will describe the current relative Sass-import practice rather than
claiming that `_index.scss` is a configured build entrypoint. Existing EPG and
other legacy token usages will be labeled migration debt, not examples to copy.
Shared changes will require cross-consumer and light/dark review.

### Xtream

`xtream-electron` will describe capability-based SQLite/PWA selection,
type-aware content identity, canonical detail/collection routing, sparse VOD,
VOD multi-source ownership, worker/network cancellation boundaries, current
store composition, and exact web/Electron validation routes. Reusable UI will
belong to `portal/shared/ui`; persistence orchestration will belong to
`portal/shared/data-access`; pure helpers remain in `portal/shared/util`.

### Stalker

`stalker-portal` will distinguish attaching playback metadata before handoff
from persisting it during position updates. It will record the series-scoped
tracking and legacy compatibility contract, shared-interface coverage, eager
bulk EPG behavior, and the relevant unit/E2E validation.

## Documentation Synchronization

The implementation and docs will agree on these points:

- Stalker bulk ITV EPG loads eagerly when channel rows become available;
- short EPG is only the active-channel fallback;
- Stalker generated IDs are series-scoped deterministic tracking IDs, not
  globally unique database identities;
- internal notes remain in the changelog but not the public GitHub body;
- release publication triggers automatic Snap `edge` and Docker effects;
- application surfaces use repository `--app-*` tokens;
- the Electron DB worker development flow requires rebuilding the compiled
  worker and restarting Electron.

Existing authoritative documents will be updated before creating new
architecture documents.

## Skill Verification

The audit findings provide the baseline failure cases for each existing skill:
agents following the old text would make an incorrect release-side-effect
assumption, choose an invalid shared UI owner, miss an identity component,
misapply cancellation, or copy an unsafe token.

After each skill is edited, a focused application scenario will be run with the
new skill available. The scenario must produce the expected owner, invariant,
and validation command without relying on the audit report. Release-skill
scenarios will additionally verify that the `.codex` and `.claude` copies are
byte-identical.

## Validation Strategy

Before Nx discovery or project targets, install the locked workspace
dependencies and verify discovery:

```bash
pnpm install --frozen-lockfile
pnpm nx show projects
```

The validation ladder is:

1. Run release parser/gate/screenshot Node test suites.
2. Run `pnpm run release:notes:validate`.
3. Run focused Stalker adapter and catalog tests during the TDD red/green
   cycles.
4. Run `portal-stalker-data-access`, `portal-stalker-feature`, and
   `shared-interfaces` tests.
5. Run dashboard tests if position normalization or badge expectations change.
6. Run affected lint/build targets discovered through Nx.
7. Run the closest atomized Stalker E2E target if its fixture covers lazy
   `is_series`; otherwise record the fixture gap and perform the strongest
   Electron build/manual verification available.
8. Re-run literal skill-path validation, frontmatter checks, mirror hashes, and
   `git diff --check`.

## Documentation and Release Note Policy

The Stalker playback-position correction is user-visible and therefore receives
one `.changes/` fix note written for users. Release tooling, skill text, CI
workflow, and documentation-only changes do not receive additional notes.

Final reporting will name every updated canonical document, every test added or
changed, every validation command and result, and any skipped E2E with its
reason.

## Acceptance Criteria

The work is complete when:

1. all eight skills pass their focused application scenarios;
2. release mirrors are byte-identical;
3. public release extraction excludes internal notes without altering the
   changelog;
4. all supported `is_series` flag forms follow the same catalog path;
5. two Stalker shows cannot generate the same tracking ID solely from matching
   season/episode coordinates;
6. legacy Stalker progress resumes through the compatibility path;
7. canonical docs contain no eager-versus-first-playback or release-side-effect
   contradictions;
8. targeted tests, affected validation, release-note validation, and repository
   hygiene checks pass.
