# Agent context map

Read the row for your task before editing. For a cross-domain change, read each
affected contract. This is navigation, not a request to load every linked file.
Common constraints remain in [AGENTS.md](../../AGENTS.md); Claude imports it.
Repository skill frontmatter defines triggers. If your client does not discover
a listed skill automatically, read its SKILL.md directly. Optional global tools
are not prerequisites for reading repository contracts.

## Development and maintenance

| Area / code ownership | Canonical documents | Repository skill |
| --- | --- | --- |
| Bootstrap, project placement, dependencies, aliases and lint configuration; root Nx config and project-local project.json files | [Nx boundaries](../architecture/nx-workspace-boundaries.md), [security overrides](../architecture/dependency-security-overrides.md) | [Nx architecture](../../.codex/skills/iptvnator-nx-architecture/SKILL.md) |
| Angular conventions; docs and skills maintenance | [Agent workflow](../development/agent-workflow.md) | Use the area's skill below |
| Unit, E2E, lint and coverage; `tools/coverage` | [Validation map](../architecture/validation-map.md) | Use the area's validation section |
| Performance journeys, benchmark probes and the ratchet; `apps/electron-backend-e2e/src/journeys`, `apps/electron-backend-e2e/src/performance` | [Performance journeys](../architecture/performance-journeys.md) | None |
| Electron entry/events/preload and CDP; `apps/electron-backend` | [Debugging and trace flags](../development/electron-debugging.md), [Electron security](../architecture/electron-security.md) | Use the available global electron skill for automation |
| Releases, notes, screenshots, native assets, Linux manager metadata; `tools/release` | [Release pipeline](../architecture/release-pipeline.md), [note format](../../.changes/README.md) | [Release notes](../../.codex/skills/release-notes/SKILL.md), [release cut](../../.codex/skills/release-cut/SKILL.md) |

## Data, sources and networking

| Area / code ownership | Required contracts | Repository skill |
| --- | --- | --- |
| SQLite schema/startup; `libs/shared/database`; Electron DB events/workers/operations | [DB worker](../architecture/sqlite-db-worker.md), [migration ownership and tests](../../libs/shared/database/README.md) | [SQLite worker](../../.codex/skills/iptvnator-sqlite-db-worker/SKILL.md) |
| M3U import/state/player, XMLTV, source lifecycle, startup readiness and OS file opening; `libs/m3u-state`, `libs/playlist`, `libs/epg` | [M3U module](../architecture/m3u-playlist-module.md), [adding sources across layers](../development/agent-workflow.md#adding-behavior-across-layers) | Read both contracts when adding a source |
| Xtream API/store/data sources and routed views; `libs/portal/xtream` | [Xtream compatibility](../architecture/xtream-portal-compatibility.md), [category management](../architecture/category-management.md), [detail navigation](../architecture/portal-detail-navigation.md) | [Xtream](../../.codex/skills/xtream-electron/SKILL.md) |
| Stalker/Ministra protocol, identity, sessions and routed views; `libs/portal/stalker` | [Stalker portal](../architecture/stalker-portal.md), [Stalker EPG](../architecture/stalker-epg.md) for EPG work, [store API baseline](../architecture/stalker-store-api-baseline.md) for store API changes | [Stalker](../../.codex/skills/stalker-portal/SKILL.md) |
| Browser runtime, HTTP proxies, redirects and backend networking; `apps/web-backend`, `libs/shared/host-health` | [PWA/self-hosting](../architecture/pwa-self-hosted.md), [connectivity guard](../architecture/host-connectivity-guard.md), [Electron security](../architecture/electron-security.md) for desktop boundary changes | Read the affected runtime contract |
| Source health and selective cleanup; portal shared data access | [Desktop source health](../architecture/m3u-playlist-module.md#desktop-source-health), [subscription expiry](../architecture/workspace-dashboard.md#source-subscription-expiry) | Read the affected provider skill |
| Backup and restore; playlist persistence | [Backup/restore](../architecture/playlist-backup-restore.md), [database migrations](../../libs/shared/database/README.md) | Read the affected persistence skill |

## Playback, navigation and UI

| Area / code ownership | Required contracts | Repository skill |
| --- | --- | --- |
| Web engines, controls, tracks, PiP, radio and display sleep; `libs/ui/playback` | [Player controls](../architecture/player-controls-contract.md), [inline playback/diagnostics/recovery](../architecture/embedded-inline-playback.md) | Read the contract directly |
| Embedded MPV, platform engines, addon, pinned runtime and packaging; Electron native services, `tools/embedded-mpv` | [Native MPV](../architecture/embedded-mpv-native.md), [runtime build and licensing](../../tools/embedded-mpv/README.md) | Read the contract directly |
| Live panels, keyboard focus, grid/layout conventions; shared UI and portal views | [UI guidelines](../architecture/iptvnator-ui-guidelines.md), [detail navigation](../architecture/portal-detail-navigation.md) | [UI design](../../.codex/skills/iptvnator-ui-design/SKILL.md), [theme/style](../../.codex/skills/iptvnator-theme-style/SKILL.md) |
| Workspace routes, title bar, switcher, collections and dashboard; `libs/workspace` | [Workspace shell](../architecture/workspace-shell.md), [dashboard](../architecture/workspace-dashboard.md), [collection/detail navigation](../architecture/portal-detail-navigation.md) | UI/theme skills for visible changes |
| Remote control, playback queue, channel return and shortcuts; `libs/ui/remote-control`, `apps/remote-control-web` | [Remote control](../architecture/remote-control.md) | Provider skill when queue ownership changes |
| Downloads, offline details, catch-up and file availability; `libs/portal/downloads` | [Download manager](../architecture/download-manager.md), provider contract for URL resolution | Read the affected provider skill |
| VOD source discovery, factual metadata and failover; `libs/portal/shared/data-access` | [VOD multi-source](../architecture/vod-multi-source.md) | [Xtream](../../.codex/skills/xtream-electron/SKILL.md) |
| TMDB enrichment, artwork, actors and recommendations; `libs/services/src/lib/tmdb` | [TMDB contracts](../architecture/tmdb-metadata-enrichment.md), [dashboard](../architecture/workspace-dashboard.md) | UI skill for rendering changes |
| Timezones, catch-up formatting and EPG display offsets | [Date handling](../architecture/date-handling.md), [Xtream compatibility](../architecture/xtream-portal-compatibility.md), [M3U EPG](../architecture/m3u-playlist-module.md) | Affected provider skill |
| Website, blog and download pages; `apps/website` | [Website README](../../apps/website/README.md) | Use an available website skill |
| Mock servers and fictional release fixtures; `apps/stalker-mock-server`, `apps/xtream-mock-server` | [Stalker mock](../architecture/stalker-mock-server.md), [Xtream mock](../architecture/xtream-mock-server.md), [release screenshot contract](../architecture/release-pipeline.md) | Release-cut for release captures |

## Maintenance rules

Keep unique behavior contracts in the authoritative document, procedures in a
skill or development guide, and universal constraints in AGENTS.md. Update this
map when ownership or a canonical destination changes. Preserve release skill
mirrors; do not create extra copies of other contracts for individual agents.
Use normal Markdown links for document destinations so `pnpm run agents:validate`
can check them. Do not add root imports for the linked documents.

The [migration ledger](agent-guidance-migration.md) explains how the original
root instructions were accounted for. It is historical audit evidence, not
another source of current runtime policy or required task context.
