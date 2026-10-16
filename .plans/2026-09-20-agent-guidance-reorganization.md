# Agent guidance reorganization — issue #1643

Approved implementation plan, 2026-09-20.

## Outcome

One source of common instructions: AGENTS.md (at most 200 lines / 16 KiB).
CLAUDE.md imports @AGENTS.md and contains only Claude-specific guidance
(at most 30 lines / 2 KiB). Do not increase Codex loading limits. No runtime
or public API changes.

## Knowledge preservation

Inventory both original files at the starting commit in
`docs/maintenance/agent-guidance-migration.md`. Record source section and line
ranges, destination document and heading, and whether each contract was moved,
merged with an existing equivalent, or corrected with evidence. Split long
player sections into individual contracts. Preserve exceptions, commands,
rationale and platform constraints. Do not create a required monolithic archive.

## Destinations

Use existing authoritative docs first: Nx boundaries for structure/dependencies;
validation-map for tests/lint; release-pipeline and release skills for releases;
sqlite-db-worker and the database README for IPC/migrations; m3u-playlist-module
for M3U/XMLTV/startup/source health; Xtream/Stalker compatibility docs for portals;
player-controls-contract for web controls/radio/sleep; embedded-mpv-native for
native runtime/packaging; UI guidelines, detail navigation and remote control for
navigation; PWA/host connectivity/security docs for networking; existing download,
TMDB, multi-source, workspace and backup docs for their domains; website README
for website policy.

Create docs/development/agent-workflow.md for documentation/skill maintenance and
Angular conventions, and docs/development/electron-debugging.md for CDP/tracing.
Add a developer navigation link in README.md.

## Root guidance and navigation

Retain project purpose, essential commands, .nvmrc/frozen install/Nx bootstrap,
scoped imports and boundaries, migration safety, credential redaction, regression
coverage, release-note/doc requirements, protected Markdown formatting and plan
storage. Preserve the Nx-managed block/markers, conditional on available tools.
Replace mandatory root-file updates with updates to each subsystem's canonical
doc. Root instructions hold only universal rules and a compact topic routing table.
Create docs/maintenance/agent-context-map.md with topics, code paths, docs and
skills. Read affected contracts only; cross-domain work reads each relevant one.
Update existing skills rather than proliferating copies; preserve byte-identical
release mirrors. No mass nested instructions in this change.

## Tooling

Extend repository-skills (no new Nx project) with agents:validate and node:test
coverage. Check UTF-8 bytes/line budgets, one standalone @AGENTS.md import in
CLAUDE.md and no other root imports, local navigation/map/migration links and
anchors, and literal repository paths without treating globs/commands as paths.
Add an unconditional CI validation step and correct Nx test inputs/lint commands.

## Acceptance

Tests cover exact/over budgets, UTF-8, LF/CRLF, missing/duplicate/extra imports,
missing local files and anchors. Run frozen install, Nx discovery, repository-skills
test/lint, agents:validate, skills:validate, release:notes:validate, git diff --check
and workflow validation. Audit every source block to a destination, with no
unresolved or lost unique contract. Walk navigation for XMLTV, Xtream, MPV,
migrations and releases. App unit/E2E is unnecessary (no runtime changes); no
release note for docs/tooling validation. Do not run whole-file Prettier on docs,
AGENTS.md or CLAUDE.md.
