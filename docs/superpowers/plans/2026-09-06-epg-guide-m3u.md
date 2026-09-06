# Programme Guide (Multi-EPG) Redesign — M3U Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SVG multi-EPG overlay with a host-agnostic `app-epg-guide` grid that shows the M3U playlist's own channels, switches playback on click, keeps the player docked on top, and looks like the EPG timeline.

**Architecture:** `libs/ui/epg/src/lib/epg-guide/` holds the grid and a data contract (`EPG_GUIDE_SOURCE`). The M3U host (`VideoPlayerComponent`) provides an adapter for that contract, owns a `guideOpen` layout mode that CSS-reflows the player into a docked strip, and exposes four entry points. Two new Electron IPCs (`EPG_GET_PROGRAMS_FOR_CHANNELS`, `EPG_GET_PROGRAM_COVERAGE`) replace `EPG_GET_CHANNELS_BY_RANGE`. Spec: `docs/superpowers/specs/2026-09-06-epg-guide-m3u-design.md`.

**Tech Stack:** Angular 20 signals + CDK virtual scroll, NgRx (`@iptvnator/m3u-state`), Electron IPC + Drizzle/SQLite, Jest (`run-web-esm-lib-tests.mjs` for web libs, `@nx/jest` for `electron-backend`), Playwright (`electron-backend-e2e`).

---

## Conventions for every task

- Run all commands from the worktree root: `/Users/4gray/Code/iptvnator/.claude/worktrees/multi-epg-view-feature-1efd4d`.
- **Running one web-lib spec.** `pnpm nx test <project>` on `ui-epg`, `playlist-m3u-feature-player`, `epg-data-access` and `services` always runs the whole project (the runner passes `--runTestsByPath` for every spec). To run one file:
  ```bash
  NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath <path/to/file.spec.ts>
  ```
- **Running one backend spec:** `pnpm nx test electron-backend --testPathPatterns=<file-basename>`.
- Production TypeScript files stay under 300 lines (hard limit 400, blank lines and comments not counted). Never add a file to `tools/eslint/max-lines-baseline.mjs`.
- Use `@iptvnator/...` scoped aliases only. Signal-based inputs/outputs, `@if`/`@for` control flow.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Existing helpers referenced below (do not re-implement): `getProgramTimeMs` (`libs/ui/epg/src/lib/epg-program.utils.ts`), `buildTimelineBlocks`/`buildTimelineAxis`/`classifyTimelineWhen` (`epg-timeline.utils.ts`), `buildTimelineRenderItems`/`tierFor` (`epg-timeline-render.util.ts`), `epgProviderClockMs`/`epgDisplayTimeMs` (`@iptvnator/shared/interfaces`), `getTodayEpgDateKey`/`parseEpgDateKey`/`shiftEpgDateKey` (`libs/ui/epg/src/lib/epg-date.ts`), `isTypingInInput` (`@iptvnator/portal/shared/util`), `resolveChannelEpgLookupKey` (`@iptvnator/m3u-state`), `EpgProgrammeDialogService` (`libs/ui/epg`), `queryByResolvedChannelIds`/`resolveChannelIds` (`apps/electron-backend/src/app/events/epg-mapping.service.ts`).

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/electron-backend/src/app/events/epg-guide-query.service.ts` | Window-scoped programme + coverage SQL for a batch of channel keys |
| `apps/electron-backend/src/app/events/epg-guide-query.service.spec.ts` | Backend unit tests |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-source.ts` | `EPG_GUIDE_SOURCE` token and contract types |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-layout.util.ts` (+ spec) | Day axis, ticks, now-x, block layout for one row |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-preferences.ts` (+ spec) | localStorage persistence for density/zoom/toggle/dock |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.ts` (+ spec) | Per-day programme cache, batched loading, coverage |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.ts` (+ spec) | Roving focus + key commands |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-toolbar.component.ts/.html/.scss` | Toolbar |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-row.component.ts/.html/.scss` | One channel row |
| `libs/ui/epg/src/lib/epg-guide/epg-guide.component.ts/.html/.scss` (+ spec) | Grid shell |
| `libs/ui/epg/src/lib/epg-guide/epg-guide-now-playing.component.ts/.html/.scss` | Docked strip info block |
| `libs/playlist/m3u/feature-player/src/lib/epg-guide/m3u-epg-guide-source.service.ts` (+ spec) | M3U adapter for the contract |
| `apps/electron-backend-e2e/src/epg-guide.e2e.ts` | E2E |
| `.changes/epg-programme-guide.md` | Release note |

**Modified**

| File | Change |
| --- | --- |
| `libs/shared/interfaces/src/lib/electron-api.interface.ts` | New bridge methods/types; drop `getEpgChannelsByRange` + `ElectronBridgeEpgChannelWithPrograms` |
| `libs/shared/interfaces/src/lib/ipc-commands.ts` | Drop `EPG_GET_CHANNELS_BY_RANGE*` constants |
| `apps/electron-backend/src/app/api/main.preload.ts` (+ `.spec-data.ts`) | New methods, drop old |
| `apps/electron-backend/src/app/events/epg.events.ts` | Register two IPCs, drop old |
| `apps/electron-backend/src/app/events/epg-query.service.ts` | Drop `getChannelsByRange` |
| `libs/services/src/lib/runtime-capabilities.service.ts` (+ spec) | `supportsEpgGuide` replaces `supportsEpgChannelBrowser` |
| `libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts` (+ spec) | New bridge calls, drop old |
| `apps/web/src/app/settings/test-stubs/settings-test-harness.stub.ts` | Stub method rename |
| `libs/ui/epg/src/index.ts` | Export guide, drop multi-epg |
| `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.ts/.html/.scss` | `openGuide` output + Guide button |
| `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.ts/.html/.scss/.spec.ts/.spec-stubs.ts` | Guide mode, entry points |
| `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell.facade.spec.ts`, `.../workspace-command-palette/workspace-command-palette.component.spec.ts` | Command id rename |
| `apps/web/src/assets/i18n/*.json` (19 files) | `EPG.GUIDE.*` keys, drop `TOP_MENU.OPEN_MULTI_EPG`, `WORKSPACE.SHELL.COMMANDS.OPEN_MULTI_EPG_DESCRIPTION` |
| `apps/web/src/styles.scss` | Drop `#epg-navigation` drag-region rule |
| `libs/ui/components/src/lib/window-controls/window-controls.component.ts`, `libs/ui/epg/src/lib/epg-item-description/epg-item-description.component.ts` | Comment updates |
| `apps/electron-backend-e2e/src/epg.e2e.ts` | `getEpgChannelCount` uses `getEpgChannels` |
| `tools/eslint/max-lines-baseline.mjs` | Regenerated (multi-epg entry gone) |
| `docs/architecture/m3u-playlist-module.md`, `docs/architecture/workspace-shell.md`, `docs/architecture/pwa-self-hosted.md`, `CLAUDE.md` | Docs |

**Deleted**: `libs/ui/epg/src/lib/multi-epg/` (all files).

---

### Task 1: Backend guide query service (programmes + coverage for a channel batch)

**Files:**
- Create: `apps/electron-backend/src/app/events/epg-guide-query.service.ts`
- Create: `apps/electron-backend/src/app/events/epg-guide-query.service.spec.ts`

Design notes: keys are resolved to XMLTV channel ids with the existing
`EpgQueryService.getChannelMetadata` (exact id → case-insensitive id →
display name, scoped then legacy). Programmes are read with one SQL over
`idx_epg_programs_time_range`. Like the M3U timeline (`EpgService.getChannelPrograms`
without options) the guide queries unscoped by default; `sourceUrls` stays in the
contract for portal hosts. Manual mappings are applied at the IPC boundary
(Task 2), not here.

- [ ] **Step 1: Write the failing spec**

```ts
// apps/electron-backend/src/app/events/epg-guide-query.service.spec.ts
import {
    EPG_GUIDE_MAX_CHANNELS_PER_REQUEST,
    EpgGuideQueryService,
    normalizeGuideWindow,
} from './epg-guide-query.service';

const getDatabase = jest.fn();

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

jest.mock('../util/epg-logger', () => ({
    epgLogger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
}));

function flattenSql(value: unknown, seen = new Set<unknown>()): string {
    if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return String(value ?? '');
    }
    if (seen.has(value)) {
        return '';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => flattenSql(item, seen)).join(' ');
    }
    const sqlLike = value as {
        name?: unknown;
        queryChunks?: unknown[];
        value?: unknown;
    };
    if (Array.isArray(sqlLike.queryChunks)) {
        return sqlLike.queryChunks
            .map((chunk) => flattenSql(chunk, seen))
            .join(' ');
    }
    if (Array.isArray(sqlLike.value)) {
        return sqlLike.value.join(' ');
    }
    if (typeof sqlLike.value === 'string') {
        return sqlLike.value;
    }
    if (typeof sqlLike.name === 'string') {
        return sqlLike.name;
    }
    return '';
}

function programRow(
    channelId: string,
    start: string,
    stop: string,
    title: string
) {
    return {
        channelId,
        start,
        stop,
        title,
        description: null,
        category: null,
        iconUrl: null,
        rating: null,
        episodeNum: null,
    };
}

/** `db.select(cols).from().where().orderBy()` resolving to `rows`. */
function programSelect(rows: unknown[], whereCalls: unknown[]) {
    return jest.fn(() => ({
        from: jest.fn(() => ({
            where: jest.fn((condition: unknown) => {
                whereCalls.push(condition);
                return { orderBy: jest.fn().mockResolvedValue(rows) };
            }),
        })),
    }));
}

/** `db.selectDistinct(cols).from().where()` resolving to `rows`. */
function coverageSelect(rows: unknown[], whereCalls: unknown[]) {
    return jest.fn(() => ({
        from: jest.fn(() => ({
            where: jest.fn((condition: unknown) => {
                whereCalls.push(condition);
                return Promise.resolve(rows);
            }),
        })),
    }));
}

const FROM = Date.UTC(2026, 8, 6, 0, 0, 0);
const TO = Date.UTC(2026, 8, 7, 0, 0, 0);

describe('normalizeGuideWindow', () => {
    it('rejects an empty or inverted window', () => {
        expect(
            normalizeGuideWindow({ channelIds: ['a'], fromMs: TO, toMs: FROM })
        ).toBeNull();
        expect(
            normalizeGuideWindow({ channelIds: [' '], fromMs: FROM, toMs: TO })
        ).toBeNull();
        expect(
            normalizeGuideWindow({
                channelIds: ['a'],
                fromMs: Number.NaN,
                toMs: TO,
            })
        ).toBeNull();
    });

    it('trims, de-duplicates and caps the channel keys', () => {
        const ids = Array.from({ length: 150 }, (_, index) => `ch-${index}`);
        const window = normalizeGuideWindow({
            channelIds: [' a ', 'a', ...ids],
            fromMs: FROM,
            toMs: TO,
        });
        expect(window?.channelIds[0]).toBe('a');
        expect(window?.channelIds).toHaveLength(
            EPG_GUIDE_MAX_CHANNELS_PER_REQUEST
        );
        expect(window?.fromIso).toBe('2026-09-06T00:00:00.000Z');
        expect(window?.toIso).toBe('2026-09-07T00:00:00.000Z');
    });
});

describe('EpgGuideQueryService', () => {
    const getChannelMetadata = jest.fn();
    let service: EpgGuideQueryService;

    beforeEach(() => {
        getDatabase.mockReset();
        getChannelMetadata.mockReset();
        service = new EpgGuideQueryService({ getChannelMetadata }, '[Test]');
    });

    it('returns an empty list per requested key for an invalid window', async () => {
        const result = await service.getProgramsForChannels({
            channelIds: ['a', 'b'],
            fromMs: TO,
            toMs: FROM,
        });
        expect(result).toEqual({ a: [], b: [] });
        expect(getChannelMetadata).not.toHaveBeenCalled();
    });

    it('resolves keys through channel metadata and maps rows back onto every requested key', async () => {
        getChannelMetadata.mockResolvedValue({
            'ZDF HD': { id: 'zdf.de', displayName: 'ZDF HD', iconUrl: null },
            'zdf.de': { id: 'zdf.de', displayName: 'ZDF HD', iconUrl: null },
            unknown: null,
        });
        const whereCalls: unknown[] = [];
        getDatabase.mockResolvedValue({
            select: programSelect(
                [
                    programRow(
                        'zdf.de',
                        '2026-09-06T16:00:00.000Z',
                        '2026-09-06T16:45:00.000Z',
                        'heute-journal'
                    ),
                    programRow(
                        'zdf.de',
                        '2026-09-06T16:00:00.000Z',
                        '2026-09-06T16:45:00.000Z',
                        'heute-journal'
                    ),
                ],
                whereCalls
            ),
        });

        const result = await service.getProgramsForChannels({
            channelIds: ['ZDF HD', 'zdf.de', 'unknown'],
            fromMs: FROM,
            toMs: TO,
        });

        expect(getChannelMetadata).toHaveBeenCalledWith(
            ['ZDF HD', 'zdf.de', 'unknown'],
            {}
        );
        expect(result['ZDF HD']).toHaveLength(1);
        expect(result['zdf.de']).toHaveLength(1);
        expect(result['ZDF HD'][0]).toMatchObject({
            channel: 'zdf.de',
            title: 'heute-journal',
        });
        expect(result['unknown']).toEqual([]);
        const condition = flattenSql(whereCalls[0]);
        expect(condition).toContain('channel_id');
        expect(condition).toContain('2026-09-07T00:00:00.000Z');
        expect(condition).toContain('2026-09-06T00:00:00.000Z');
    });

    it('scopes the programme rows to the requested source URLs', async () => {
        getChannelMetadata.mockResolvedValue({
            a: { id: 'a', displayName: 'A', iconUrl: null },
        });
        const whereCalls: unknown[] = [];
        getDatabase.mockResolvedValue({
            select: programSelect([], whereCalls),
        });

        await service.getProgramsForChannels({
            channelIds: ['a'],
            fromMs: FROM,
            toMs: TO,
            sourceUrls: ['https://guide.example.com/epg.xml'],
        });

        expect(getChannelMetadata).toHaveBeenCalledWith(['a'], {
            sourceUrls: ['https://guide.example.com/epg.xml'],
        });
        expect(flattenSql(whereCalls[0])).toContain('source_url');
    });

    it('fails soft when the database throws', async () => {
        getChannelMetadata.mockResolvedValue({
            a: { id: 'a', displayName: 'A', iconUrl: null },
        });
        getDatabase.mockRejectedValue(new Error('locked'));

        await expect(
            service.getProgramsForChannels({
                channelIds: ['a'],
                fromMs: FROM,
                toMs: TO,
            })
        ).resolves.toEqual({ a: [] });
    });

    it('reports coverage for the requested keys whose channel has a programme in the window', async () => {
        getChannelMetadata.mockResolvedValue({
            'ZDF HD': { id: 'zdf.de', displayName: 'ZDF HD', iconUrl: null },
            'ARTE': { id: 'arte.de', displayName: 'ARTE', iconUrl: null },
            none: null,
        });
        const whereCalls: unknown[] = [];
        getDatabase.mockResolvedValue({
            selectDistinct: coverageSelect([{ channelId: 'zdf.de' }], whereCalls),
        });

        const covered = await service.getProgramCoverage({
            channelIds: ['ZDF HD', 'ARTE', 'none'],
            fromMs: FROM,
            toMs: TO,
        });

        expect(covered).toEqual(['ZDF HD']);
        expect(flattenSql(whereCalls[0])).toContain('channel_id');
    });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm nx test electron-backend --testPathPatterns=epg-guide-query.service`
Expected: FAIL — `Cannot find module './epg-guide-query.service'`.

- [ ] **Step 3: Implement the service**

```ts
// apps/electron-backend/src/app/events/epg-guide-query.service.ts
import { and, inArray, sql, type SQL } from 'drizzle-orm';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { epgLogger } from '../util/epg-logger';
import { epgQueryService, EpgQueryService } from './epg-query.service';

/** The renderer splits larger batches; anything beyond this is dropped. */
export const EPG_GUIDE_MAX_CHANNELS_PER_REQUEST = 100;

/** Largest |ms| `Date` can serialize; a corrupt payload must not throw in SQL. */
const MAX_SERIALIZABLE_MS = 8.64e15;

export interface EpgGuideWindowRequest {
    channelIds: string[];
    /** Provider-clock instants (the renderer removes the display offset). */
    fromMs: number;
    toMs: number;
    sourceUrls?: string[];
}

export interface NormalizedGuideWindow {
    channelIds: string[];
    fromIso: string;
    toIso: string;
    sourceUrls: string[];
}

interface GuideProgramRow {
    channelId: string;
    start: string;
    stop: string;
    title: string;
    description: string | null;
    category: string | null;
    iconUrl: string | null;
    rating: string | null;
    episodeNum: string | null;
}

type ChannelResolver = Pick<EpgQueryService, 'getChannelMetadata'>;

function isUsableInstant(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= MAX_SERIALIZABLE_MS
    );
}

/** Validates and trims a request; `null` means "nothing to query". */
export function normalizeGuideWindow(
    request: EpgGuideWindowRequest
): NormalizedGuideWindow | null {
    if (
        !isUsableInstant(request.fromMs) ||
        !isUsableInstant(request.toMs) ||
        request.fromMs >= request.toMs ||
        !Array.isArray(request.channelIds)
    ) {
        return null;
    }
    const channelIds = Array.from(
        new Set(
            request.channelIds
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter((id) => id.length > 0)
        )
    ).slice(0, EPG_GUIDE_MAX_CHANNELS_PER_REQUEST);
    if (channelIds.length === 0) {
        return null;
    }
    const sourceUrls = Array.from(
        new Set(
            (request.sourceUrls ?? [])
                .map((url) => url.trim())
                .filter((url) => url.length > 0)
        )
    );
    return {
        channelIds,
        fromIso: new Date(request.fromMs).toISOString(),
        toIso: new Date(request.toMs).toISOString(),
        sourceUrls,
    };
}

/**
 * Programme-guide reads for a batch of playlist channel keys: every programme
 * overlapping a time window, and which keys have any programme in it at all.
 * Keys resolve to XMLTV channel ids through the same metadata lookup the
 * sidebar uses (exact id, case-insensitive id, display name); manual mappings
 * are applied by the IPC layer before the keys reach this service.
 */
export class EpgGuideQueryService {
    constructor(
        private readonly resolver: ChannelResolver = epgQueryService,
        private readonly loggerLabel = '[EPG Guide]'
    ) {}

    async getProgramsForChannels(
        request: EpgGuideWindowRequest
    ): Promise<Record<string, EpgProgram[]>> {
        const result = this.emptyResult(request.channelIds);
        const window = normalizeGuideWindow(request);
        if (!window) {
            return result;
        }
        try {
            const resolved = await this.resolveChannelIds(window);
            const epgIds = Array.from(new Set(resolved.values()));
            if (epgIds.length === 0) {
                return result;
            }
            const db = await getDatabase();
            const rows: GuideProgramRow[] = await db
                .select({
                    channelId: schema.epgPrograms.channelId,
                    start: schema.epgPrograms.start,
                    stop: schema.epgPrograms.stop,
                    title: schema.epgPrograms.title,
                    description: schema.epgPrograms.description,
                    category: schema.epgPrograms.category,
                    iconUrl: schema.epgPrograms.iconUrl,
                    rating: schema.epgPrograms.rating,
                    episodeNum: schema.epgPrograms.episodeNum,
                })
                .from(schema.epgPrograms)
                .where(this.windowCondition(epgIds, window))
                .orderBy(schema.epgPrograms.start);
            const byEpgId = this.groupPrograms(rows);
            for (const [requestedId, epgId] of resolved) {
                result[requestedId] = byEpgId.get(epgId) ?? [];
            }
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                'Error loading guide programmes:',
                error
            );
        }
        return result;
    }

    async getProgramCoverage(
        request: EpgGuideWindowRequest
    ): Promise<string[]> {
        const window = normalizeGuideWindow(request);
        if (!window) {
            return [];
        }
        try {
            const resolved = await this.resolveChannelIds(window);
            const epgIds = Array.from(new Set(resolved.values()));
            if (epgIds.length === 0) {
                return [];
            }
            const db = await getDatabase();
            const rows: Array<{ channelId: string }> = await db
                .selectDistinct({ channelId: schema.epgPrograms.channelId })
                .from(schema.epgPrograms)
                .where(this.windowCondition(epgIds, window));
            const covered = new Set(rows.map((row) => row.channelId));
            return window.channelIds.filter((requestedId) => {
                const epgId = resolved.get(requestedId);
                return epgId !== undefined && covered.has(epgId);
            });
        } catch (error) {
            epgLogger.error(
                this.loggerLabel,
                'Error loading guide coverage:',
                error
            );
            return [];
        }
    }

    private emptyResult(channelIds: string[]): Record<string, EpgProgram[]> {
        const result: Record<string, EpgProgram[]> = {};
        for (const id of Array.isArray(channelIds) ? channelIds : []) {
            if (typeof id === 'string' && id.trim().length > 0) {
                result[id.trim()] = [];
            }
        }
        return result;
    }

    /** requested key → XMLTV channel id (keys without a match are absent). */
    private async resolveChannelIds(
        window: NormalizedGuideWindow
    ): Promise<Map<string, string>> {
        const metadata = await this.resolver.getChannelMetadata(
            window.channelIds,
            window.sourceUrls.length > 0
                ? { sourceUrls: window.sourceUrls }
                : {}
        );
        const resolved = new Map<string, string>();
        for (const requestedId of window.channelIds) {
            const epgId = metadata[requestedId]?.id;
            if (epgId) {
                resolved.set(requestedId, epgId);
            }
        }
        return resolved;
    }

    /**
     * Overlap test in SQLite `datetime()` so provider-local offsets in the
     * stored ISO strings compare correctly against the UTC window bounds.
     */
    private windowCondition(
        epgIds: string[],
        window: NormalizedGuideWindow
    ): SQL {
        const overlap = and(
            inArray(schema.epgPrograms.channelId, epgIds),
            sql`datetime(${schema.epgPrograms.start}) < datetime(${window.toIso})`,
            sql`datetime(${schema.epgPrograms.stop}) > datetime(${window.fromIso})`
        ) as SQL;
        if (window.sourceUrls.length === 0) {
            return overlap;
        }
        return and(
            overlap,
            inArray(schema.epgPrograms.sourceUrl, window.sourceUrls)
        ) as SQL;
    }

    /** Group by channel and collapse duplicate slots (same start + title). */
    private groupPrograms(rows: GuideProgramRow[]): Map<string, EpgProgram[]> {
        const grouped = new Map<string, EpgProgram[]>();
        const seen = new Set<string>();
        for (const row of rows) {
            const key = `${row.channelId}|${row.start}|${row.title}`;
            if (seen.has(key) || !row.start || !row.stop || !row.title) {
                continue;
            }
            seen.add(key);
            const list = grouped.get(row.channelId) ?? [];
            list.push({
                start: row.start,
                stop: row.stop,
                channel: row.channelId,
                title: row.title,
                desc: row.description,
                category: row.category,
                iconUrl: row.iconUrl,
                rating: row.rating,
                episodeNum: row.episodeNum,
            });
            grouped.set(row.channelId, list);
        }
        return grouped;
    }
}

export const epgGuideQueryService = new EpgGuideQueryService();
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm nx test electron-backend --testPathPatterns=epg-guide-query.service`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/electron-backend/src/app/events/epg-guide-query.service.ts apps/electron-backend/src/app/events/epg-guide-query.service.spec.ts
git commit -m "feat(epg): add window-scoped guide programme queries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: IPC, bridge contract, preload and runtime capability

**Files:**
- Modify: `libs/shared/interfaces/src/lib/electron-api.interface.ts:366-412` (types) and `:797-810` (methods)
- Modify: `apps/electron-backend/src/app/events/epg.events.ts:1-20` (imports), `:100-106` (handler registration), `:252-264` (handler)
- Modify: `apps/electron-backend/src/app/api/main.preload.ts:661-676`
- Modify: `apps/electron-backend/src/app/api/main.preload.spec-data.ts:498-521`
- Modify: `libs/services/src/lib/runtime-capabilities.service.ts:94-139` and `libs/services/src/lib/runtime-capabilities.service.spec.ts`
- Modify: `libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts` and `.spec.ts`
- Modify: `apps/web/src/app/settings/test-stubs/settings-test-harness.stub.ts:243`
- Modify: `libs/shared/interfaces/src/lib/ipc-commands.ts:7-9`

This task removes `EPG_GET_CHANNELS_BY_RANGE` at the same time so the bridge
never carries two guide feeds. The old grid still compiles against
`getChannelsByRange` until Task 10 deletes it, so keep `EpgQueryService.getChannelsByRange`
for now (Task 10 removes it) but drop every bridge/preload/contract mention here.

- [ ] **Step 1: Add contract types and methods**

In `libs/shared/interfaces/src/lib/electron-api.interface.ts`, right after
`ElectronBridgeCurrentProgramsOptions` (line ~381) add:

```ts
export interface ElectronBridgeEpgGuideWindow
    extends ElectronBridgeEpgLookupOptions {
    /** Playlist channel lookup keys (tvg-id, else name), ≤100 per call. */
    channelIds: string[];
    /** Provider-clock window bounds in epoch ms. */
    fromMs: number;
    toMs: number;
}
```

Delete the `ElectronBridgeEpgChannelWithPrograms` interface (line ~409) and, if
`ElectronBridgeEpgChannelSummary` is now unused elsewhere (`grep -rn ElectronBridgeEpgChannelSummary libs apps`), delete it too.

Replace the `getEpgChannelsByRange` member (lines ~806-809) with:

```ts
    getEpgProgramsForChannels: (
        window: ElectronBridgeEpgGuideWindow
    ) => Promise<Record<string, EpgProgram[]>>;
    getEpgProgramCoverage: (
        window: ElectronBridgeEpgGuideWindow
    ) => Promise<string[]>;
```

In `libs/shared/interfaces/src/lib/ipc-commands.ts` delete the two
`EPG_GET_CHANNELS_BY_RANGE*` constants (lines 7-9); nothing imports them.

- [ ] **Step 2: Preload + spec-data**

In `apps/electron-backend/src/app/api/main.preload.ts` replace the
`getEpgChannelsByRange` entry with:

```ts
    getEpgProgramsForChannels: (window: ElectronBridgeEpgGuideWindow) =>
        ipcRenderer.invoke('EPG_GET_PROGRAMS_FOR_CHANNELS', window),
    getEpgProgramCoverage: (window: ElectronBridgeEpgGuideWindow) =>
        ipcRenderer.invoke('EPG_GET_PROGRAM_COVERAGE', window),
```

and add `ElectronBridgeEpgGuideWindow` to the `@iptvnator/shared/interfaces` import list at the top of the file.

In `main.preload.spec-data.ts` replace the `getEpgChannelsByRange` case with:

```ts
    {
        method: 'getEpgProgramsForChannels',
        args: [{ channelIds, fromMs: 1_000, toMs: 2_000 }],
        channel: 'EPG_GET_PROGRAMS_FOR_CHANNELS',
        forwardedArgs: [{ channelIds, fromMs: 1_000, toMs: 2_000 }],
    },
    {
        method: 'getEpgProgramCoverage',
        args: [{ channelIds, fromMs: 1_000, toMs: 2_000 }],
        channel: 'EPG_GET_PROGRAM_COVERAGE',
        forwardedArgs: [{ channelIds, fromMs: 1_000, toMs: 2_000 }],
    },
```

- [ ] **Step 3: Register the IPC handlers**

In `apps/electron-backend/src/app/events/epg.events.ts`:

Imports — add `ElectronBridgeEpgGuideWindow` to the `@iptvnator/shared/interfaces` import, add
`import { epgGuideQueryService } from './epg-guide-query.service';`, and add
`resolveChannelIds` to the `./epg-mapping.service` import list.

Replace the `EPG_GET_CHANNELS_BY_RANGE` registration block with:

```ts
        ipcMain.handle(
            'EPG_GET_PROGRAMS_FOR_CHANNELS',
            async (_event, args: ElectronBridgeEpgGuideWindow) => {
                return this.handleGetGuidePrograms(args);
            }
        );

        ipcMain.handle(
            'EPG_GET_PROGRAM_COVERAGE',
            async (_event, args: ElectronBridgeEpgGuideWindow) => {
                return this.handleGetGuideCoverage(args);
            }
        );
```

Replace the `handleGetChannelsByRange` static method with:

```ts
    /**
     * Guide reads take playlist channel keys. Manual mappings are applied
     * here, before the query, and the answer is keyed back by the requested
     * key so the renderer never sees a mapped id.
     */
    private static async handleGetGuidePrograms(
        args: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]>> {
        const requested = Array.isArray(args?.channelIds) ? args.channelIds : [];
        const mapping = await resolveChannelIds(requested);
        const resolvedIds = requested.map((id) => mapping.get(id) ?? id);
        const programs = await epgGuideQueryService.getProgramsForChannels({
            ...args,
            channelIds: resolvedIds,
        });
        return Object.fromEntries(
            requested.map((id) => [id, programs[mapping.get(id) ?? id] ?? []])
        );
    }

    private static async handleGetGuideCoverage(
        args: ElectronBridgeEpgGuideWindow
    ): Promise<string[]> {
        const requested = Array.isArray(args?.channelIds) ? args.channelIds : [];
        const mapping = await resolveChannelIds(requested);
        const resolvedIds = requested.map((id) => mapping.get(id) ?? id);
        const covered = new Set(
            await epgGuideQueryService.getProgramCoverage({
                ...args,
                channelIds: resolvedIds,
            })
        );
        return requested.filter((id) => covered.has(mapping.get(id) ?? id));
    }
```

- [ ] **Step 4: Runtime capability**

In `libs/services/src/lib/runtime-capabilities.service.ts` replace the
`supportsEpgChannelBrowser` getter with:

```ts
    /** Both guide reads exist: programmes for a channel batch and coverage. */
    get supportsEpgGuide(): boolean {
        return (
            this.hasElectronMethod('getEpgProgramsForChannels') &&
            this.hasElectronMethod('getEpgProgramCoverage')
        );
    }
```

and inside `get supportsEpg()` replace `this.supportsEpgChannelBrowser &&` with `this.supportsEpgGuide &&`.

In `runtime-capabilities.service.spec.ts` replace every `getEpgChannelsByRange: jest.fn()` stub with both
`getEpgProgramsForChannels: jest.fn(), getEpgProgramCoverage: jest.fn(),` and every
`expect(service.supportsEpgChannelBrowser)` with `expect(service.supportsEpgGuide)`. Add one case:

```ts
    it('does not report guide support with only one of the two guide reads', () => {
        window.electron = {
            getEpgProgramsForChannels: jest.fn(),
        } as unknown as typeof window.electron;
        const service = TestBed.inject(RuntimeCapabilitiesService);
        expect(service.supportsEpgGuide).toBe(false);
    });
```

(Mirror how the surrounding tests construct `window.electron`; keep their style.)

In `apps/web/src/app/settings/test-stubs/settings-test-harness.stub.ts:243` replace
`getEpgChannelsByRange: jest.fn().mockResolvedValue([]),` with
`getEpgProgramsForChannels: jest.fn().mockResolvedValue({}),` and
`getEpgProgramCoverage: jest.fn().mockResolvedValue([]),`.

- [ ] **Step 5: Bridge service**

In `libs/epg/data-access/src/lib/epg-runtime-bridge.service.ts`:

- Import list: replace `ElectronBridgeEpgChannelWithPrograms` with `ElectronBridgeEpgGuideWindow`.
- `EpgElectronBridge` pick list: replace `'getEpgChannelsByRange'` with `'getEpgProgramsForChannels' | 'getEpgProgramCoverage'`.
- Replace the `supportsChannelBrowser` getter with `get supportsGuide(): boolean { return this.runtime.supportsEpgGuide; }`.
- Replace `getChannelsByRange` with:

```ts
    getProgramsForChannels(
        window: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]> | null> {
        if (!this.supportsGuide || window.channelIds.length === 0) {
            return Promise.resolve(null);
        }
        return (
            this.bridge?.getEpgProgramsForChannels?.(window) ??
            Promise.resolve(null)
        );
    }

    getProgramCoverage(
        window: ElectronBridgeEpgGuideWindow
    ): Promise<string[] | null> {
        if (!this.supportsGuide || window.channelIds.length === 0) {
            return Promise.resolve(null);
        }
        return (
            this.bridge?.getEpgProgramCoverage?.(window) ??
            Promise.resolve(null)
        );
    }
```

In `epg-runtime-bridge.service.spec.ts`: rename the capability stub field
`supportsEpgChannelBrowser` → `supportsEpgGuide`, and replace the
`getEpgChannelsByRange` test (lines ~125-165) with:

```ts
    it('forwards guide reads when the runtime supports them', async () => {
        const getEpgProgramsForChannels = jest.fn().mockResolvedValue({ a: [] });
        const getEpgProgramCoverage = jest.fn().mockResolvedValue(['a']);
        window.electron = {
            getEpgProgramsForChannels,
            getEpgProgramCoverage,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpgGuide = true;

        const window_ = { channelIds: ['a'], fromMs: 1, toMs: 2 };
        await expect(service.getProgramsForChannels(window_)).resolves.toEqual({ a: [] });
        await expect(service.getProgramCoverage(window_)).resolves.toEqual(['a']);
        expect(getEpgProgramsForChannels).toHaveBeenCalledWith(window_);
        expect(getEpgProgramCoverage).toHaveBeenCalledWith(window_);
    });

    it('answers null for guide reads without runtime support or channels', async () => {
        runtimeCapabilities.supportsEpgGuide = false;
        await expect(
            service.getProgramsForChannels({ channelIds: ['a'], fromMs: 1, toMs: 2 })
        ).resolves.toBeNull();
        runtimeCapabilities.supportsEpgGuide = true;
        await expect(
            service.getProgramCoverage({ channelIds: [], fromMs: 1, toMs: 2 })
        ).resolves.toBeNull();
    });
```

(Adapt variable names to the existing `describe` scaffolding: it already has `service` and `runtimeCapabilities`.)

- [ ] **Step 6: Temporarily keep the old grid compiling**

`libs/ui/epg/src/lib/multi-epg/multi-epg-container.component.ts` calls
`epgBridge.supportsChannelBrowser` and `epgBridge.getChannelsByRange`. Until
Task 10 deletes it, change both call sites to `this.epgBridge.supportsGuide`
and `Promise.resolve([])` respectively so `typecheck` passes:

```ts
        if (!this.epgBridge.supportsGuide) {
```
```ts
            const response = await Promise.resolve(
                [] as Array<{ id: string; displayName: string; iconUrl: string | null; programs: EpgProgram[] }>
            );
```

(`multi-epg-container.component.spec.ts` stubs `getChannelsByRange`; delete that stub line and the assertion on it, or `it.skip` the affected case — the file goes away in Task 10.)

- [ ] **Step 7: Run the affected specs and typecheck**

Run:
```bash
pnpm nx test electron-backend --testPathPatterns='main.preload|epg.events'
pnpm nx test services
pnpm nx test epg-data-access
pnpm run typecheck:ci
```
Expected: all PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add -A libs/shared/interfaces apps/electron-backend/src/app/api apps/electron-backend/src/app/events/epg.events.ts libs/services libs/epg/data-access apps/web/src/app/settings/test-stubs libs/ui/epg/src/lib/multi-epg
git commit -m "feat(epg): expose guide programme and coverage reads over the bridge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: Guide contract, day-axis layout util and preferences (`libs/ui/epg`)

**Files:**
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-source.ts`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-layout.util.ts`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-layout.util.spec.ts`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-preferences.ts`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-preferences.spec.ts`

- [ ] **Step 1: Write the contract (types only, no tests needed)**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-source.ts
import { InjectionToken, Signal } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';

/** One row of the guide. `id` is host-stable (M3U: `Channel.id`). */
export interface EpgGuideChannel {
    id: string;
    /** 1-based position inside the current scope; shown in the channel cell. */
    number: number;
    name: string;
    logoUrl: string | null;
    /**
     * Programme lookup key (M3U: tvg-id, else tvg-name, else name). `null`
     * means the host already knows there is no EPG binding, so the guide
     * renders "no programme information" without asking.
     */
    epgKey: string | null;
}

export type EpgGuideScopeKind = 'all' | 'group' | 'favorites';

export interface EpgGuideScope {
    id: string;
    label: string;
    kind: EpgGuideScopeKind;
}

/** A request window. Instants are provider-clock ms (display offset removed). */
export interface EpgGuideWindow {
    channels: EpgGuideChannel[];
    fromMs: number;
    toMs: number;
}

export interface EpgGuideCatchUp {
    canWatch(channel: EpgGuideChannel, program: EpgProgram): boolean;
    watch(channel: EpgGuideChannel, program: EpgProgram): void;
}

/**
 * Everything the guide needs from its host. The host owns scope state,
 * playback and the player; the guide owns rendering, caching and keyboard
 * navigation. Portal hosts implement the same contract with their own EPG
 * feeds (sub-project 2).
 */
export interface EpgGuideSource {
    /** Scope-resolved channels in playlist order (radio/movies excluded by host). */
    readonly channels: Signal<EpgGuideChannel[]>;
    readonly scopes: Signal<EpgGuideScope[]>;
    readonly scopeId: Signal<string>;
    setScope(id: string): void;
    /** Programmes overlapping the window, keyed by `EpgGuideChannel.id`. */
    loadPrograms(window: EpgGuideWindow): Promise<Map<string, EpgProgram[]>>;
    /** Ids of channels with at least one programme in the window. */
    loadCoverage(window: EpgGuideWindow): Promise<Set<string>>;
    readonly activeChannelId: Signal<string | null>;
    /** Switch playback; the guide stays open. */
    activate(channelId: string): void;
    /** Optional programme search; the toolbar hides its field when absent. */
    searchPrograms?(query: string): Promise<EpgProgram[]>;
    readonly catchUp?: EpgGuideCatchUp;
}

export const EPG_GUIDE_SOURCE = new InjectionToken<EpgGuideSource>(
    'EPG_GUIDE_SOURCE'
);
```

- [ ] **Step 2: Write the failing layout spec**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-layout.util.spec.ts
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    buildGuideDayAxis,
    buildGuideRowBlocks,
    buildGuideTicks,
    EPG_GUIDE_ZOOM_DEFAULT,
    guideNowLeftPx,
    guideTrackWidthPx,
    guideXForMs,
} from './epg-guide-layout.util';

const HOUR = 3_600_000;

function program(startMs: number, stopMs: number, title = 'P'): EpgProgram {
    return {
        start: new Date(startMs).toISOString(),
        stop: new Date(stopMs).toISOString(),
        channel: 'ch',
        title,
        desc: null,
        category: null,
    };
}

describe('epg-guide-layout.util', () => {
    const axis = buildGuideDayAxis('2026-09-06');

    it('builds a local-midnight day axis of exactly 24 hours', () => {
        expect(axis.dayKey).toBe('2026-09-06');
        expect(axis.endMs - axis.startMs).toBe(24 * HOUR);
        expect(new Date(axis.startMs).getHours()).toBe(0);
    });

    it('places a tick every 30 minutes, hours emphasised', () => {
        const ticks = buildGuideTicks(axis, 240);
        expect(ticks).toHaveLength(48);
        expect(ticks[0]).toEqual({ ms: axis.startMs, leftPx: 0, kind: 'hour' });
        expect(ticks[1]).toEqual({
            ms: axis.startMs + HOUR / 2,
            leftPx: 120,
            kind: 'half',
        });
        expect(guideTrackWidthPx(240)).toBe(5760);
    });

    it('maps instants to x by the hour width and hides "now" outside the day', () => {
        expect(guideXForMs(axis, axis.startMs + 2 * HOUR, 240)).toBe(480);
        expect(guideNowLeftPx(axis, axis.startMs + HOUR, 240)).toBe(240);
        expect(guideNowLeftPx(axis, axis.startMs - 1, 240)).toBeNull();
        expect(guideNowLeftPx(axis, axis.endMs, 240)).toBeNull();
    });

    it('lays out programmes overlapping the day, including boundary crossers, with tiers', () => {
        const nowMs = axis.startMs + 16 * HOUR + 4 * 60_000;
        const blocks = buildGuideRowBlocks(
            [
                program(axis.startMs - HOUR, axis.startMs + HOUR, 'Crosser'),
                program(axis.startMs + 16 * HOUR, axis.startMs + 16.75 * HOUR, 'Now'),
                program(axis.startMs + 17 * HOUR, axis.startMs + 17 * HOUR + 5 * 60_000, 'Micro'),
                program(axis.endMs + HOUR, axis.endMs + 2 * HOUR, 'Tomorrow'),
            ],
            { axis, hourWidthPx: EPG_GUIDE_ZOOM_DEFAULT, nowMs, offsetMinutes: 0 }
        );
        expect(blocks.map((block) => block.block.program.title)).toEqual([
            'Crosser',
            'Now',
            'Micro',
        ]);
        expect(blocks[0].leftPx).toBe(-240);
        expect(blocks[1].block.when).toBe('now');
        expect(blocks[1].nowFillPercent).toBeCloseTo((4 / 45) * 100, 3);
        expect(blocks[2].tier).toBe('narrow');
    });

    it('shifts programme times by the display offset before layout', () => {
        const blocks = buildGuideRowBlocks(
            [program(axis.startMs + 10 * HOUR, axis.startMs + 11 * HOUR)],
            { axis, hourWidthPx: 240, nowMs: axis.startMs, offsetMinutes: 60 }
        );
        expect(blocks[0].leftPx).toBe(11 * 240);
    });
});
```

- [ ] **Step 3: Run the spec to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/ui/epg/src/lib/epg-guide/epg-guide-layout.util.spec.ts`
Expected: FAIL — cannot find module `./epg-guide-layout.util`.

- [ ] **Step 4: Implement the layout util**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-layout.util.ts
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { addDays, addMinutes } from 'date-fns';
import { parseEpgDateKey } from '../epg-date';
import {
    buildTimelineBlocks,
    TimelineAxis,
} from '../epg-timeline/epg-timeline.utils';
import {
    buildTimelineRenderItems,
    TimelineRenderBlock,
} from '../epg-timeline/epg-timeline-render.util';

const HOUR_MS = 3_600_000;

/** Pixels per hour. */
export const EPG_GUIDE_ZOOM_MIN = 120;
export const EPG_GUIDE_ZOOM_MAX = 480;
export const EPG_GUIDE_ZOOM_STEP = 20;
export const EPG_GUIDE_ZOOM_DEFAULT = 240;

export type EpgGuideDensity = 'comfortable' | 'compact';
export const EPG_GUIDE_ROW_HEIGHT_PX: Record<EpgGuideDensity, number> = {
    comfortable: 60,
    compact: 44,
};
export const EPG_GUIDE_CHANNEL_COLUMN_PX = 232;
/** Rows loaded ahead of the rendered range, in each direction. */
export const EPG_GUIDE_ROW_BUFFER = 10;

/** One selected day in DISPLAY time (local midnight to local midnight). */
export interface EpgGuideDayAxis extends TimelineAxis {
    readonly dayKey: string;
}

export interface EpgGuideTick {
    readonly ms: number;
    readonly leftPx: number;
    readonly kind: 'hour' | 'half';
}

export interface EpgGuideRowLayoutOptions {
    readonly axis: EpgGuideDayAxis;
    readonly hourWidthPx: number;
    readonly nowMs: number;
    readonly offsetMinutes: number;
    readonly catchUpAvailable?: boolean;
}

export function buildGuideDayAxis(dayKey: string): EpgGuideDayAxis {
    const start = parseEpgDateKey(dayKey);
    return {
        dayKey,
        startMs: start.getTime(),
        endMs: addDays(start, 1).getTime(),
    };
}

export function guideTrackWidthPx(hourWidthPx: number): number {
    return hourWidthPx * 24;
}

export function guideXForMs(
    axis: TimelineAxis,
    ms: number,
    hourWidthPx: number
): number {
    return ((ms - axis.startMs) / HOUR_MS) * hourWidthPx;
}

/** x of the now-line, or null when "now" is not on the selected day. */
export function guideNowLeftPx(
    axis: TimelineAxis,
    nowMs: number,
    hourWidthPx: number
): number | null {
    if (nowMs < axis.startMs || nowMs >= axis.endMs) {
        return null;
    }
    return guideXForMs(axis, nowMs, hourWidthPx);
}

export function buildGuideTicks(
    axis: TimelineAxis,
    hourWidthPx: number
): EpgGuideTick[] {
    const ticks: EpgGuideTick[] = [];
    const start = new Date(axis.startMs);
    for (let minute = 0; minute < 24 * 60; minute += 30) {
        const ms = addMinutes(start, minute).getTime();
        ticks.push({
            ms,
            leftPx: guideXForMs(axis, ms, hourWidthPx),
            kind: minute % 60 === 0 ? 'hour' : 'half',
        });
    }
    return ticks;
}

/**
 * Positioned blocks for one channel row, sharing the timeline's block maths
 * (`buildTimelineBlocks` → `buildTimelineRenderItems`) so both guides agree
 * on tiers, minimum widths and the on-now fill. Programmes are shifted into
 * display time by `offsetMinutes` and compared with the wall-clock `nowMs`
 * (the display form of the EPG offset contract). Short-run grouping is off:
 * a grid row has no room for group chips.
 */
export function buildGuideRowBlocks(
    programs: readonly EpgProgram[],
    options: EpgGuideRowLayoutOptions
): TimelineRenderBlock[] {
    const { axis, hourWidthPx, nowMs, offsetMinutes } = options;
    const blocks = buildTimelineBlocks(
        programs,
        axis,
        nowMs,
        offsetMinutes
    ).filter(
        (block) => block.stopMs > axis.startMs && block.startMs < axis.endMs
    );
    const items = buildTimelineRenderItems(blocks, hourWidthPx / 60, {
        allowGroup: false,
        nowMs,
        archivePlaybackAvailable: options.catchUpAvailable ?? false,
    });
    return items.filter(
        (item): item is TimelineRenderBlock => item.kind === 'block'
    );
}
```

- [ ] **Step 5: Run the layout spec to verify it passes**

Same command as Step 3. Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing preferences spec**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-preferences.spec.ts
import {
    EPG_GUIDE_DENSITY_KEY,
    EPG_GUIDE_DOCK_COLLAPSED_KEY,
    EPG_GUIDE_ONLY_WITH_EPG_KEY,
    EPG_GUIDE_ZOOM_KEY,
    persistEpgGuideDockCollapsed,
    persistEpgGuidePreferences,
    restoreEpgGuideDockCollapsed,
    restoreEpgGuidePreferences,
} from './epg-guide-preferences';
import { EPG_GUIDE_ZOOM_DEFAULT } from './epg-guide-layout.util';

describe('epg-guide-preferences', () => {
    beforeEach(() => localStorage.clear());

    it('falls back to comfortable density, default zoom and the toggle off', () => {
        expect(restoreEpgGuidePreferences()).toEqual({
            density: 'comfortable',
            zoom: EPG_GUIDE_ZOOM_DEFAULT,
            onlyWithEpg: false,
        });
        expect(restoreEpgGuideDockCollapsed()).toBe(false);
    });

    it('round-trips every preference and clamps the zoom', () => {
        persistEpgGuidePreferences({
            density: 'compact',
            zoom: 9_999,
            onlyWithEpg: true,
        });
        persistEpgGuideDockCollapsed(true);
        expect(localStorage.getItem(EPG_GUIDE_DENSITY_KEY)).toBe('compact');
        expect(localStorage.getItem(EPG_GUIDE_ONLY_WITH_EPG_KEY)).toBe('1');
        expect(localStorage.getItem(EPG_GUIDE_DOCK_COLLAPSED_KEY)).toBe('1');
        expect(restoreEpgGuidePreferences()).toEqual({
            density: 'compact',
            zoom: 480,
            onlyWithEpg: true,
        });
        expect(restoreEpgGuideDockCollapsed()).toBe(true);
    });

    it('ignores corrupt stored values', () => {
        localStorage.setItem(EPG_GUIDE_DENSITY_KEY, 'huge');
        localStorage.setItem(EPG_GUIDE_ZOOM_KEY, 'abc');
        expect(restoreEpgGuidePreferences().density).toBe('comfortable');
        expect(restoreEpgGuidePreferences().zoom).toBe(EPG_GUIDE_ZOOM_DEFAULT);
    });

    it('survives a throwing storage', () => {
        const broken = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
        } as unknown as Storage;
        expect(() =>
            persistEpgGuidePreferences(
                { density: 'compact', zoom: 200, onlyWithEpg: false },
                broken
            )
        ).not.toThrow();
        expect(restoreEpgGuidePreferences(broken).density).toBe('comfortable');
    });
});
```

- [ ] **Step 7: Implement preferences**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-preferences.ts
import {
    EPG_GUIDE_ZOOM_DEFAULT,
    EPG_GUIDE_ZOOM_MAX,
    EPG_GUIDE_ZOOM_MIN,
    EpgGuideDensity,
} from './epg-guide-layout.util';

export const EPG_GUIDE_DENSITY_KEY = 'epg-guide:density';
export const EPG_GUIDE_ZOOM_KEY = 'epg-guide:zoom';
export const EPG_GUIDE_ONLY_WITH_EPG_KEY = 'epg-guide:only-with-epg';
export const EPG_GUIDE_DOCK_COLLAPSED_KEY = 'epg-guide:dock-collapsed';

export interface EpgGuidePreferences {
    density: EpgGuideDensity;
    zoom: number;
    onlyWithEpg: boolean;
}

function isDensity(value: unknown): value is EpgGuideDensity {
    return value === 'comfortable' || value === 'compact';
}

export function clampGuideZoom(value: number): number {
    if (!Number.isFinite(value)) {
        return EPG_GUIDE_ZOOM_DEFAULT;
    }
    return Math.min(EPG_GUIDE_ZOOM_MAX, Math.max(EPG_GUIDE_ZOOM_MIN, value));
}

function read(storage: Storage, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

function write(storage: Storage, key: string, value: string): void {
    try {
        storage.setItem(key, value);
    } catch {
        // Storage may be unavailable (private mode, quota); the guide simply
        // starts from defaults next time.
    }
}

function defaultStorage(): Storage {
    return globalThis.localStorage;
}

export function restoreEpgGuidePreferences(
    storage: Storage = defaultStorage()
): EpgGuidePreferences {
    const density = read(storage, EPG_GUIDE_DENSITY_KEY);
    const zoom = Number(read(storage, EPG_GUIDE_ZOOM_KEY));
    return {
        density: isDensity(density) ? density : 'comfortable',
        zoom: clampGuideZoom(zoom === 0 ? Number.NaN : zoom),
        onlyWithEpg: read(storage, EPG_GUIDE_ONLY_WITH_EPG_KEY) === '1',
    };
}

export function persistEpgGuidePreferences(
    preferences: EpgGuidePreferences,
    storage: Storage = defaultStorage()
): void {
    write(storage, EPG_GUIDE_DENSITY_KEY, preferences.density);
    write(storage, EPG_GUIDE_ZOOM_KEY, String(clampGuideZoom(preferences.zoom)));
    write(storage, EPG_GUIDE_ONLY_WITH_EPG_KEY, preferences.onlyWithEpg ? '1' : '0');
}

export function restoreEpgGuideDockCollapsed(
    storage: Storage = defaultStorage()
): boolean {
    return read(storage, EPG_GUIDE_DOCK_COLLAPSED_KEY) === '1';
}

export function persistEpgGuideDockCollapsed(
    collapsed: boolean,
    storage: Storage = defaultStorage()
): void {
    write(storage, EPG_GUIDE_DOCK_COLLAPSED_KEY, collapsed ? '1' : '0');
}
```

- [ ] **Step 8: Run the preferences spec to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/ui/epg/src/lib/epg-guide/epg-guide-preferences.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add libs/ui/epg/src/lib/epg-guide
git commit -m "feat(epg): add guide source contract, day layout maths and preferences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Programme cache service with batched loading and coverage

**Files:**
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.ts`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.spec.ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideSource,
} from './epg-guide-source';
import {
    EPG_GUIDE_LOAD_CHUNK,
    EpgGuideProgramsService,
} from './epg-guide-programs.service';

function channel(id: string, epgKey: string | null = id): EpgGuideChannel {
    return { id, number: 1, name: id, logoUrl: null, epgKey };
}

function programFor(channelId: string): EpgProgram {
    return {
        start: '2026-09-06T16:00:00.000Z',
        stop: '2026-09-06T17:00:00.000Z',
        channel: channelId,
        title: `${channelId} show`,
        desc: null,
        category: null,
    };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('EpgGuideProgramsService', () => {
    const channels = signal<EpgGuideChannel[]>([]);
    const loadPrograms = jest.fn<Promise<Map<string, EpgProgram[]>>, [unknown]>();
    const loadCoverage = jest.fn<Promise<Set<string>>, [unknown]>();
    let service: EpgGuideProgramsService;

    beforeEach(() => {
        loadPrograms.mockReset();
        loadCoverage.mockReset();
        loadCoverage.mockResolvedValue(new Set());
        channels.set([channel('a'), channel('b'), channel('c', null)]);
        const source: EpgGuideSource = {
            channels,
            scopes: signal([]),
            scopeId: signal('all'),
            setScope: jest.fn(),
            loadPrograms,
            loadCoverage,
            activeChannelId: signal(null),
            activate: jest.fn(),
        };
        TestBed.configureTestingModule({
            providers: [
                EpgGuideProgramsService,
                { provide: EPG_GUIDE_SOURCE, useValue: source },
            ],
        });
        service = TestBed.inject(EpgGuideProgramsService);
    });

    it('reports "none" for channels without an EPG key and never requests them', async () => {
        loadPrograms.mockResolvedValue(new Map());
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.statusFor('c')).toBe('none');
        const requested = loadPrograms.mock.calls[0][0] as { channels: EpgGuideChannel[] };
        expect(requested.channels.map((item) => item.id)).toEqual(['a', 'b']);
    });

    it('loads visible rows once, in chunks, and exposes their programmes', async () => {
        const many = Array.from({ length: EPG_GUIDE_LOAD_CHUNK + 5 }, (_, i) =>
            channel(`ch-${i}`)
        );
        channels.set(many);
        loadPrograms.mockImplementation(async (window) => {
            const { channels: requested } = window as { channels: EpgGuideChannel[] };
            return new Map(requested.map((item) => [item.id, [programFor(item.id)]]));
        });
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(many);
        expect(service.statusFor('ch-0')).toBe('loading');
        await flush();
        expect(loadPrograms).toHaveBeenCalledTimes(2);
        expect(service.statusFor('ch-0')).toBe('loaded');
        expect(service.programsFor('ch-0')[0].title).toBe('ch-0 show');
        service.ensureLoaded(many);
        expect(loadPrograms).toHaveBeenCalledTimes(2);
    });

    it('drops responses that belong to a previous window', async () => {
        let resolveFirst!: (value: Map<string, EpgProgram[]>) => void;
        loadPrograms.mockImplementationOnce(
            () => new Promise((resolve) => (resolveFirst = resolve))
        );
        loadPrograms.mockResolvedValueOnce(new Map());
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        service.setWindow(3_000, 4_000);
        service.ensureLoaded(channels());
        resolveFirst(new Map([['a', [programFor('a')]]]));
        await flush();
        expect(service.programsFor('a')).toEqual([]);
    });

    it('marks a failed batch as loaded-empty instead of retrying on every scroll', async () => {
        loadPrograms.mockRejectedValue(new Error('ipc down'));
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.statusFor('a')).toBe('loaded');
        service.ensureLoaded(channels());
        expect(loadPrograms).toHaveBeenCalledTimes(1);
    });

    it('loads coverage for the whole scope when the window is set and answers isCovered', async () => {
        loadCoverage.mockResolvedValue(new Set(['a']));
        expect(service.coverageLoaded()).toBe(false);
        expect(service.isCovered('b')).toBe(true);
        service.setWindow(1_000, 2_000);
        await flush();
        expect(loadCoverage).toHaveBeenCalledTimes(1);
        expect(service.coverageLoaded()).toBe(true);
        expect(service.isCovered('a')).toBe(true);
        expect(service.isCovered('b')).toBe(false);
        expect(service.isCovered('c')).toBe(false);
    });

    it('resets programmes and coverage when the scope channels change', async () => {
        loadPrograms.mockResolvedValue(new Map([['a', [programFor('a')]]]));
        service.setWindow(1_000, 2_000);
        service.ensureLoaded(channels());
        await flush();
        expect(service.programsFor('a')).toHaveLength(1);
        channels.set([channel('a'), channel('z')]);
        TestBed.flushEffects();
        await flush();
        expect(service.statusFor('a')).toBe('idle');
        expect(loadCoverage).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the service**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.ts
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideWindow,
} from './epg-guide-source';

/** Channels per `loadPrograms` call (the programme IPC caps at 100 keys). */
export const EPG_GUIDE_LOAD_CHUNK = 100;
/** Channels per `loadCoverage` call (the coverage IPC caps at 2000 keys). */
export const EPG_GUIDE_COVERAGE_CHUNK = 1000;

export type EpgGuideRowStatus = 'idle' | 'loading' | 'loaded' | 'none';

const EMPTY: EpgProgram[] = [];

/**
 * Per-day programme cache for the guide. Programmes load lazily for the rows
 * the viewport asks about; coverage (which rows have anything at all) loads
 * eagerly for the whole scope so "Only with EPG" can answer before rows
 * scroll into view. Every response is tagged with the generation it was
 * requested under, so a window or scope change makes older answers no-ops.
 */
@Injectable()
export class EpgGuideProgramsService {
    private readonly source = inject(EPG_GUIDE_SOURCE);

    private readonly programs = signal<ReadonlyMap<string, EpgProgram[]>>(
        new Map()
    );
    private readonly statuses = signal<ReadonlyMap<string, EpgGuideRowStatus>>(
        new Map()
    );
    private readonly coverage = signal<ReadonlySet<string> | null>(null);

    private window: { fromMs: number; toMs: number } | null = null;
    private generation = 0;

    readonly coverageLoaded = computed(() => this.coverage() !== null);

    constructor() {
        // A new channel set (scope change) invalidates everything, including
        // coverage: the toggle must be answered for the new rows.
        effect(() => {
            this.source.channels();
            this.invalidate();
            this.requestCoverage();
        });
    }

    setWindow(fromMs: number, toMs: number): void {
        if (this.window?.fromMs === fromMs && this.window?.toMs === toMs) {
            return;
        }
        this.window = { fromMs, toMs };
        this.invalidate();
        this.requestCoverage();
    }

    programsFor(channelId: string): EpgProgram[] {
        return this.programs().get(channelId) ?? EMPTY;
    }

    statusFor(channelId: string): EpgGuideRowStatus {
        return this.statuses().get(channelId) ?? 'idle';
    }

    /** Unknown (coverage not loaded yet) counts as covered so rows never blink. */
    isCovered(channelId: string): boolean {
        const coverage = this.coverage();
        return coverage === null || coverage.has(channelId);
    }

    /** Request programmes for rows that are idle; chunked, generation-tagged. */
    ensureLoaded(channels: readonly EpgGuideChannel[]): void {
        const window = this.window;
        if (!window) {
            return;
        }
        const pending = channels.filter(
            (channel) => this.statusFor(channel.id) === 'idle' && channel.epgKey
        );
        if (pending.length === 0) {
            return;
        }
        this.patchStatuses(pending.map((channel) => [channel.id, 'loading']));
        const generation = this.generation;
        for (let start = 0; start < pending.length; start += EPG_GUIDE_LOAD_CHUNK) {
            const chunk = pending.slice(start, start + EPG_GUIDE_LOAD_CHUNK);
            this.loadChunk({ channels: chunk, ...window }, generation);
        }
    }

    private loadChunk(window: EpgGuideWindow, generation: number): void {
        this.source
            .loadPrograms(window)
            .then(
                (result) => result,
                () => new Map<string, EpgProgram[]>()
            )
            .then((result) => {
                if (generation !== this.generation) {
                    return;
                }
                const next = new Map(this.programs());
                for (const channel of window.channels) {
                    next.set(channel.id, result.get(channel.id) ?? EMPTY);
                }
                this.programs.set(next);
                this.patchStatuses(
                    window.channels.map((channel) => [channel.id, 'loaded'])
                );
            });
    }

    private requestCoverage(): void {
        const window = this.window;
        if (!window) {
            return;
        }
        const generation = this.generation;
        const keyed = this.source
            .channels()
            .filter((channel) => channel.epgKey !== null);
        const chunks: EpgGuideChannel[][] = [];
        for (let start = 0; start < keyed.length; start += EPG_GUIDE_COVERAGE_CHUNK) {
            chunks.push(keyed.slice(start, start + EPG_GUIDE_COVERAGE_CHUNK));
        }
        Promise.all(
            chunks.map((channels) =>
                this.source
                    .loadCoverage({ channels, ...window })
                    .then(
                        (covered) => covered,
                        () => new Set<string>()
                    )
            )
        ).then((sets) => {
            if (generation !== this.generation) {
                return;
            }
            const merged = new Set<string>();
            sets.forEach((set) => set.forEach((id) => merged.add(id)));
            this.coverage.set(merged);
        });
    }

    private invalidate(): void {
        this.generation += 1;
        this.programs.set(new Map());
        this.statuses.set(
            new Map(
                this.source
                    .channels()
                    .filter((channel) => channel.epgKey === null)
                    .map((channel) => [channel.id, 'none' as const])
            )
        );
        this.coverage.set(null);
    }

    private patchStatuses(entries: Array<[string, EpgGuideRowStatus]>): void {
        const next = new Map(this.statuses());
        for (const [id, status] of entries) {
            next.set(id, status);
        }
        this.statuses.set(next);
    }
}
```

Note on the first spec case: the constructor `effect` runs on the first
change-detection flush; `setWindow` sets `none` statuses itself through
`invalidate()`, which is why the test passes without flushing effects.

- [ ] **Step 4: Run the spec to verify it passes**

Same command as Step 2. Expected: PASS (6 tests). If the last case's second
`loadCoverage` call is missing, call `TestBed.flushEffects()` once right after
`TestBed.inject` in `beforeEach` so the initial effect run is consumed before
the assertions count calls.

- [ ] **Step 5: Commit**

```bash
git add libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.ts libs/ui/epg/src/lib/epg-guide/epg-guide-programs.service.spec.ts
git commit -m "feat(epg): cache guide programmes per day with batched loading

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Keyboard controller

**Files:**
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.ts`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.spec.ts`

- [ ] **Step 1: Write the failing spec**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.spec.ts
import {
    EpgGuideKeyboardController,
    EpgGuideKeyboardHost,
} from './epg-guide-keyboard.controller';

function key(
    keyName: string,
    init: Partial<KeyboardEventInit> & { target?: EventTarget } = {}
): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: keyName, ...init });
    if (init.target) {
        Object.defineProperty(event, 'target', { value: init.target });
    }
    return event;
}

describe('EpgGuideKeyboardController', () => {
    let host: jest.Mocked<EpgGuideKeyboardHost>;
    let controller: EpgGuideKeyboardController;

    beforeEach(() => {
        host = {
            rowCount: jest.fn(() => 5),
            blockCount: jest.fn(() => 3),
            activeRow: jest.fn(() => 2),
            isBlocked: jest.fn(() => false),
            play: jest.fn(),
            details: jest.fn(),
            jumpNow: jest.fn(),
            stepDay: jest.fn(),
            close: jest.fn(),
        };
        controller = new EpgGuideKeyboardController(host);
    });

    it('starts row focus from the active channel and clamps at the ends', () => {
        expect(controller.handle(key('ArrowDown'))).toBe(true);
        expect(controller.focus()).toEqual({ row: 3, block: null });
        controller.handle(key('ArrowDown'));
        controller.handle(key('ArrowDown'));
        controller.handle(key('ArrowDown'));
        expect(controller.focus()).toEqual({ row: 4, block: null });
        host.activeRow.mockReturnValue(-1);
        controller.focus.set(null);
        controller.handle(key('ArrowUp'));
        expect(controller.focus()).toEqual({ row: 4, block: null });
    });

    it('moves block focus inside the focused row', () => {
        controller.handle(key('ArrowRight'));
        expect(controller.focus()).toEqual({ row: 2, block: 0 });
        controller.handle(key('ArrowRight'));
        controller.handle(key('ArrowRight'));
        controller.handle(key('ArrowRight'));
        expect(controller.focus()).toEqual({ row: 2, block: 2 });
        controller.handle(key('ArrowLeft'));
        expect(controller.focus()).toEqual({ row: 2, block: 1 });
        controller.handle(key('ArrowDown'));
        expect(controller.focus()).toEqual({ row: 3, block: null });
    });

    it('plays the focused (or active) row on Enter and opens details with I', () => {
        controller.handle(key('Enter'));
        expect(host.play).toHaveBeenCalledWith(2);
        controller.handle(key('ArrowDown'));
        controller.handle(key('ArrowRight'));
        controller.handle(key('i'));
        expect(host.details).toHaveBeenCalledWith(3, 0);
        controller.handle(key('Enter'));
        expect(host.play).toHaveBeenLastCalledWith(3);
    });

    it('maps N, PageUp/PageDown and Escape', () => {
        controller.handle(key('n'));
        expect(host.jumpNow).toHaveBeenCalled();
        controller.handle(key('PageUp'));
        expect(host.stepDay).toHaveBeenCalledWith('prev');
        controller.handle(key('PageDown'));
        expect(host.stepDay).toHaveBeenCalledWith('next');
        expect(controller.handle(key('Escape'))).toBe(true);
        expect(host.close).toHaveBeenCalled();
    });

    it('ignores typing, modifier chords, blocked state and unknown keys', () => {
        const input = document.createElement('input');
        expect(controller.handle(key('ArrowDown', { target: input }))).toBe(false);
        expect(controller.handle(key('ArrowDown', { ctrlKey: true }))).toBe(false);
        host.isBlocked.mockReturnValue(true);
        expect(controller.handle(key('Escape'))).toBe(false);
        host.isBlocked.mockReturnValue(false);
        expect(controller.handle(key('x'))).toBe(false);
        expect(host.close).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the controller**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.ts
import { signal } from '@angular/core';
import { EpgDateNavigationDirection } from '../epg-date';

export interface EpgGuideFocus {
    readonly row: number;
    /** Block index inside the row, or null when the whole row is focused. */
    readonly block: number | null;
}

export interface EpgGuideKeyboardHost {
    rowCount(): number;
    blockCount(row: number): number;
    /** Index of the playing channel's row, or -1. */
    activeRow(): number;
    /** True while a dialog owns the keyboard. */
    isBlocked(): boolean;
    play(row: number): void;
    details(row: number, block: number): void;
    jumpNow(): void;
    stepDay(direction: EpgDateNavigationDirection): void;
    close(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Roving focus for the guide grid. ↑/↓ move between rows, ←/→ between the
 * focused row's programmes, Enter plays the row, I opens details, N jumps to
 * now, PgUp/PgDn change the day, Esc closes. Returns whether the event was
 * consumed so the caller can `preventDefault()`.
 */
export class EpgGuideKeyboardController {
    readonly focus = signal<EpgGuideFocus | null>(null);

    constructor(private readonly host: EpgGuideKeyboardHost) {}

    handle(event: KeyboardEvent): boolean {
        if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            isEditableTarget(event.target) ||
            this.host.isBlocked()
        ) {
            return false;
        }
        switch (event.key) {
            case 'Escape':
                this.host.close();
                return true;
            case 'ArrowDown':
                return this.moveRow(1);
            case 'ArrowUp':
                return this.moveRow(-1);
            case 'ArrowRight':
                return this.moveBlock(1);
            case 'ArrowLeft':
                return this.moveBlock(-1);
            case 'Enter':
                return this.play();
            case 'i':
            case 'I':
                return this.details();
            case 'n':
            case 'N':
                this.host.jumpNow();
                return true;
            case 'PageUp':
                this.host.stepDay('prev');
                return true;
            case 'PageDown':
                this.host.stepDay('next');
                return true;
            default:
                return false;
        }
    }

    private currentRow(): number {
        const focused = this.focus();
        if (focused) {
            return focused.row;
        }
        return this.host.activeRow();
    }

    private moveRow(delta: number): boolean {
        const count = this.host.rowCount();
        if (count === 0) {
            return false;
        }
        const current = this.currentRow();
        const next =
            current < 0
                ? delta > 0
                    ? 0
                    : count - 1
                : clamp(current + delta, 0, count - 1);
        this.focus.set({ row: next, block: null });
        return true;
    }

    private moveBlock(delta: number): boolean {
        const count = this.host.rowCount();
        if (count === 0) {
            return false;
        }
        const row = clamp(Math.max(0, this.currentRow()), 0, count - 1);
        const blocks = this.host.blockCount(row);
        if (blocks === 0) {
            this.focus.set({ row, block: null });
            return true;
        }
        const current = this.focus()?.row === row ? this.focus()?.block ?? null : null;
        const start = current ?? (delta > 0 ? -1 : blocks);
        this.focus.set({ row, block: clamp(start + delta, 0, blocks - 1) });
        return true;
    }

    private play(): boolean {
        const row = this.currentRow();
        if (row < 0 || row >= this.host.rowCount()) {
            return false;
        }
        this.host.play(row);
        return true;
    }

    private details(): boolean {
        const focused = this.focus();
        if (!focused || focused.block === null) {
            return false;
        }
        this.host.details(focused.row, focused.block);
        return true;
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Same command as Step 2. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.ts libs/ui/epg/src/lib/epg-guide/epg-guide-keyboard.controller.spec.ts
git commit -m "feat(epg): add guide keyboard navigation controller

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Guide components (toolbar, row, shell, now-playing) + English i18n

**Files:**
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-toolbar.component.{ts,html,scss}`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-row.component.{ts,html,scss}`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide.component.{ts,html,scss}`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide.component.spec.ts`
- Create: `libs/ui/epg/src/lib/epg-guide/epg-guide-now-playing.component.{ts,html,scss}`
- Modify: `libs/ui/epg/src/index.ts`
- Modify: `apps/web/src/assets/i18n/en.json` (`EPG.GUIDE`, `EPG.TIMELINE.GUIDE`, `TOP_MENU.OPEN_EPG_GUIDE`, `WORKSPACE.SHELL.COMMANDS.OPEN_EPG_GUIDE_DESCRIPTION`)

Visual reference: the Q2 mockup (https://claude.ai/code/artifact/0cac36f6-9027-46a7-bd0c-b264416e6acf). All colours come from `libs/ui/epg/src/lib/_epg-theme.scss` (`@use '../epg-theme' as *;`).

- [ ] **Step 1: English i18n keys**

In `apps/web/src/assets/i18n/en.json`:

Inside `"EPG": { ... "TIMELINE": { ... } }` add to the `TIMELINE` object:
```json
            "GUIDE": "Guide",
            "OPEN_GUIDE": "Open the programme guide"
```
and add a sibling object under `"EPG"`:
```json
        "GUIDE": {
            "TITLE": "Programme guide",
            "CLOSE": "Close guide",
            "CHANNEL": "Channel",
            "TODAY": "Today",
            "NOW": "Now",
            "JUMP_NOW": "Jump to now",
            "SCOPE": "Channels shown",
            "ONLY_WITH_EPG": "Only with EPG",
            "ONLY_WITH_EPG_HINT": "Hide channels without programme data",
            "DENSITY_COMFORTABLE": "Comfortable rows",
            "DENSITY_COMPACT": "Compact rows",
            "ZOOM": "Zoom",
            "FILTER_CHANNELS": "Filter channels…",
            "SEARCH_PROGRAMMES": "Search programmes…",
            "NO_RESULTS": "No programmes found",
            "NO_PROGRAMME_INFO": "No programme information",
            "NO_PROGRAMME_INFO_LONG": "No programme information for this channel",
            "PLAYING": "Playing",
            "NO_CHANNELS": "No channels match \"{{query}}\"",
            "CLEAR_FILTER": "Clear filter",
            "COLLAPSE_PLAYER": "Collapse player",
            "EXPAND_PLAYER": "Expand player",
            "KEYS": {
                "CHANNEL": "channel",
                "PROGRAMME": "programme",
                "PLAY": "play",
                "DETAILS": "details",
                "NOW": "now",
                "DAY": "day",
                "CLOSE": "close"
            }
        },
```
In `"TOP_MENU"` replace `"OPEN_MULTI_EPG": "Open Multi-EPG view"` with `"OPEN_EPG_GUIDE": "Programme guide"`.
In `"WORKSPACE" → "SHELL" → "COMMANDS"` replace `"OPEN_MULTI_EPG_DESCRIPTION"` with `"OPEN_EPG_GUIDE_DESCRIPTION": "Open the programme guide for this playlist"`.
(Other locales: Task 11.)

- [ ] **Step 2: Now-playing component**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-now-playing.component.ts
import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    OnDestroy,
    OnInit,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import { getProgramTimeMs } from '../epg-program.utils';

/**
 * Info block of the docked player strip while the guide is open: channel,
 * current programme, progress, Close and Collapse. The host renders it next to
 * the player because the strip itself is host layout.
 */
@Component({
    selector: 'app-epg-guide-now-playing',
    imports: [DatePipe, MatButtonModule, MatIconModule, TranslatePipe],
    templateUrl: './epg-guide-now-playing.component.html',
    styleUrl: './epg-guide-now-playing.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgGuideNowPlayingComponent implements OnInit, OnDestroy {
    readonly channelName = input('');
    readonly program = input<EpgProgram | null>(null);
    readonly offsetMinutes = input(0);
    readonly collapsed = input(false);

    readonly closeRequested = output<void>();
    readonly collapsedChange = output<boolean>();

    private readonly nowMs = signal(Date.now());
    private timer?: number;

    readonly startMs = computed(() => this.boundary('start'));
    readonly stopMs = computed(() => this.boundary('stop'));
    readonly isOnNow = computed(() => {
        const start = this.startMs();
        const stop = this.stopMs();
        const now = this.nowMs();
        return start !== null && stop !== null && start <= now && now < stop;
    });
    readonly progress = computed(() => {
        const start = this.startMs();
        const stop = this.stopMs();
        if (start === null || stop === null || stop <= start) {
            return null;
        }
        const pct = ((this.nowMs() - start) / (stop - start)) * 100;
        return Math.min(100, Math.max(0, pct));
    });

    ngOnInit(): void {
        this.timer = window.setInterval(() => this.nowMs.set(Date.now()), 30_000);
    }

    ngOnDestroy(): void {
        window.clearInterval(this.timer);
    }

    private boundary(edge: 'start' | 'stop'): number | null {
        const program = this.program();
        if (!program) {
            return null;
        }
        const ms = getProgramTimeMs(
            program[edge],
            edge === 'start' ? program.startTimestamp : program.stopTimestamp,
            this.offsetMinutes()
        );
        return Number.isFinite(ms) ? ms : null;
    }
}
```

```html
<!-- libs/ui/epg/src/lib/epg-guide/epg-guide-now-playing.component.html -->
<div class="now-playing" [class.now-playing--collapsed]="collapsed()">
    <div class="now-playing__body">
        <div class="now-playing__eyebrow">
            <span>{{ channelName() }}</span>
            @if (isOnNow()) {
                <span class="now-playing__on">{{ 'EPG.TIMELINE.ON_NOW' | translate }}</span>
            }
        </div>
        @if (program(); as program) {
            <div class="now-playing__title">{{ program.title }}</div>
            @if (!collapsed() && program.desc) {
                <div class="now-playing__desc">{{ program.desc }}</div>
            }
            @if (!collapsed() && progress() !== null) {
                <div class="now-playing__progress">
                    <span>{{ startMs() | date: 'HH:mm' }}</span>
                    <i aria-hidden="true"><b [style.width.%]="progress()"></b></i>
                    <span>{{ stopMs() | date: 'HH:mm' }}</span>
                </div>
            }
        } @else {
            <div class="now-playing__title now-playing__title--muted">
                {{ 'EPG.GUIDE.NO_PROGRAMME_INFO' | translate }}
            </div>
        }
    </div>
    <div class="now-playing__actions">
        <button type="button" mat-stroked-button (click)="closeRequested.emit()">
            {{ 'EPG.GUIDE.CLOSE' | translate }} <kbd>Esc</kbd>
        </button>
        <button
            type="button"
            mat-button
            (click)="collapsedChange.emit(!collapsed())"
            [attr.aria-expanded]="!collapsed()"
        >
            {{ (collapsed() ? 'EPG.GUIDE.EXPAND_PLAYER' : 'EPG.GUIDE.COLLAPSE_PLAYER') | translate }}
        </button>
    </div>
</div>
```

```scss
// libs/ui/epg/src/lib/epg-guide/epg-guide-now-playing.component.scss
@use '../epg-theme' as *;

:host { display: block; min-width: 0; height: 100%; }

.now-playing {
    display: flex;
    align-items: center;
    gap: 18px;
    height: 100%;
    min-width: 0;
    color: $text-primary;
}
.now-playing__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.now-playing__eyebrow {
    display: flex; gap: 10px; align-items: center;
    font: 500 10px $font-mono; letter-spacing: 0.12em; text-transform: uppercase; color: $text-secondary;
    .now-playing__on { color: $live-text; }
    .now-playing__on::before { content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: $accent-live; margin-right: 5px; vertical-align: 1px; }
}
.now-playing__title { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.now-playing__title--muted { color: $text-tertiary; font-weight: 400; }
.now-playing__desc { font-size: 12px; color: $text-secondary; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60ch; }
.now-playing__progress {
    display: flex; align-items: center; gap: 10px; font: 11px $font-mono; color: $text-secondary;
    i { flex: 1; max-width: 360px; height: 4px; border-radius: 2px; background: $surface-3; overflow: hidden; display: block; }
    b { display: block; height: 100%; background: $accent-blue; }
}
.now-playing__actions { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.now-playing--collapsed {
    gap: 12px;
    .now-playing__body { flex-direction: row; align-items: center; gap: 12px; }
    .now-playing__title { font-size: 13px; }
    .now-playing__actions { flex-direction: row; }
}
kbd { font: 10px $font-mono; border: 1px solid $line-strong; border-radius: 4px; padding: 0 4px; margin-left: 6px; color: $text-secondary; }
```

- [ ] **Step 3: Toolbar component**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-toolbar.component.ts
import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgDateNavigationDirection } from '../epg-date';
import {
    EPG_GUIDE_ZOOM_MAX,
    EPG_GUIDE_ZOOM_MIN,
    EPG_GUIDE_ZOOM_STEP,
    EpgGuideDensity,
} from './epg-guide-layout.util';
import { EpgGuideScope } from './epg-guide-source';

@Component({
    selector: 'app-epg-guide-toolbar',
    imports: [
        DatePipe,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    templateUrl: './epg-guide-toolbar.component.html',
    styleUrl: './epg-guide-toolbar.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgGuideToolbarComponent {
    readonly dayMs = input.required<number>();
    readonly isToday = input(false);
    readonly currentLocale = input('en');
    readonly scopes = input<EpgGuideScope[]>([]);
    readonly scopeId = input('');
    readonly onlyWithEpg = input(false);
    readonly coverageLoaded = input(false);
    readonly density = input<EpgGuideDensity>('comfortable');
    readonly zoom = input(EPG_GUIDE_ZOOM_MIN);
    readonly filter = input('');
    readonly searchEnabled = input(false);
    readonly searchQuery = input('');
    readonly shownCount = input(0);
    readonly totalCount = input(0);

    readonly stepDay = output<EpgDateNavigationDirection>();
    readonly jumpNow = output<void>();
    readonly scopeChange = output<string>();
    readonly onlyWithEpgChange = output<boolean>();
    readonly densityChange = output<EpgGuideDensity>();
    readonly zoomChange = output<number>();
    readonly filterChange = output<string>();
    readonly searchQueryChange = output<string>();

    readonly zoomMin = EPG_GUIDE_ZOOM_MIN;
    readonly zoomMax = EPG_GUIDE_ZOOM_MAX;
    readonly zoomStep = EPG_GUIDE_ZOOM_STEP;

    readonly scopeLabel = computed(
        () =>
            this.scopes().find((scope) => scope.id === this.scopeId())?.label ??
            ''
    );
    readonly densityIcon = computed(() =>
        this.density() === 'comfortable' ? 'density_medium' : 'density_small'
    );
    readonly densityLabelKey = computed(() =>
        this.density() === 'comfortable'
            ? 'EPG.GUIDE.DENSITY_COMPACT'
            : 'EPG.GUIDE.DENSITY_COMFORTABLE'
    );

    toggleDensity(): void {
        this.densityChange.emit(
            this.density() === 'comfortable' ? 'compact' : 'comfortable'
        );
    }

    onZoomInput(event: Event): void {
        this.zoomChange.emit((event.target as HTMLInputElement).valueAsNumber);
    }

    onFilterInput(event: Event): void {
        this.filterChange.emit((event.target as HTMLInputElement).value);
    }

    onSearchInput(event: Event): void {
        this.searchQueryChange.emit((event.target as HTMLInputElement).value);
    }
}
```

```html
<!-- libs/ui/epg/src/lib/epg-guide/epg-guide-toolbar.component.html -->
<div class="guide-toolbar">
    <div class="guide-toolbar__day">
        <button type="button" mat-icon-button (click)="stepDay.emit('prev')"
            [attr.aria-label]="'EPG.PREVIOUS_DAY' | translate">
            <mat-icon>chevron_left</mat-icon>
        </button>
        <span class="guide-toolbar__date">
            {{ dayMs() | date: 'EEE, d MMM' : '' : currentLocale() }}
            @if (isToday()) { <small>{{ 'EPG.GUIDE.TODAY' | translate }}</small> }
        </span>
        <button type="button" mat-icon-button (click)="stepDay.emit('next')"
            [attr.aria-label]="'EPG.NEXT_DAY' | translate">
            <mat-icon>chevron_right</mat-icon>
        </button>
    </div>

    <button type="button" class="guide-toolbar__now" (click)="jumpNow.emit()"
        [matTooltip]="'EPG.GUIDE.JUMP_NOW' | translate">
        {{ 'EPG.GUIDE.NOW' | translate }}
    </button>

    <button type="button" class="guide-toolbar__scope" [matMenuTriggerFor]="scopeMenu"
        [attr.aria-label]="'EPG.GUIDE.SCOPE' | translate">
        {{ scopeLabel() }} <mat-icon>arrow_drop_down</mat-icon>
    </button>
    <mat-menu #scopeMenu="matMenu" class="guide-toolbar__scope-menu">
        @for (scope of scopes(); track scope.id) {
            <button mat-menu-item [class.is-selected]="scope.id === scopeId()"
                (click)="scopeChange.emit(scope.id)">
                {{ scope.label }}
            </button>
        }
    </mat-menu>

    <label class="guide-toolbar__toggle" [class.is-on]="onlyWithEpg()"
        [matTooltip]="'EPG.GUIDE.ONLY_WITH_EPG_HINT' | translate">
        <input type="checkbox" [checked]="onlyWithEpg()" [disabled]="!coverageLoaded()"
            (change)="onlyWithEpgChange.emit(!onlyWithEpg())" />
        <i aria-hidden="true"></i>
        <span>{{ 'EPG.GUIDE.ONLY_WITH_EPG' | translate }}</span>
    </label>

    <button type="button" mat-icon-button class="guide-toolbar__density" (click)="toggleDensity()"
        [matTooltip]="densityLabelKey() | translate" [attr.aria-label]="densityLabelKey() | translate">
        <mat-icon>{{ densityIcon() }}</mat-icon>
    </button>

    <label class="guide-toolbar__zoom" [matTooltip]="'EPG.GUIDE.ZOOM' | translate">
        <mat-icon>zoom_in</mat-icon>
        <input type="range" [min]="zoomMin" [max]="zoomMax" [step]="zoomStep" [value]="zoom()"
            (input)="onZoomInput($event)" [attr.aria-label]="'EPG.GUIDE.ZOOM' | translate" />
    </label>

    <span class="guide-toolbar__spacer"></span>

    <label class="guide-toolbar__input">
        <mat-icon>search</mat-icon>
        <input type="text" [value]="filter()" (input)="onFilterInput($event)"
            [placeholder]="'EPG.GUIDE.FILTER_CHANNELS' | translate" autocomplete="off" />
        @if (filter()) {
            <span class="guide-toolbar__count">{{ shownCount() }} / {{ totalCount() }}</span>
            <button type="button" mat-icon-button (click)="filterChange.emit('')"
                [attr.aria-label]="'EPG.GUIDE.CLEAR_FILTER' | translate">
                <mat-icon>close</mat-icon>
            </button>
        }
    </label>

    @if (searchEnabled()) {
        <label class="guide-toolbar__input guide-toolbar__input--search">
            <mat-icon>manage_search</mat-icon>
            <input type="text" [value]="searchQuery()" (input)="onSearchInput($event)"
                [placeholder]="'EPG.GUIDE.SEARCH_PROGRAMMES' | translate" autocomplete="off" />
            @if (searchQuery()) {
                <button type="button" mat-icon-button (click)="searchQueryChange.emit('')"
                    [attr.aria-label]="'CLOSE' | translate">
                    <mat-icon>close</mat-icon>
                </button>
            }
        </label>
    }
</div>
```

```scss
// libs/ui/epg/src/lib/epg-guide/epg-guide-toolbar.component.scss
@use '../epg-theme' as *;

:host { display: block; }
.guide-toolbar {
    display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 0 18px;
    border-bottom: 1px solid $line; background: var(--app-content-bg); color: $text-primary;
    button, label, input { font: inherit; }
}
.guide-toolbar__day {
    display: inline-flex; align-items: center; border: 1px solid $line-strong; border-radius: 8px; height: 30px; overflow: hidden;
    button { width: 30px; height: 30px; padding: 0; }
}
.guide-toolbar__date {
    display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; font-weight: 500; white-space: nowrap;
    border-left: 1px solid $line-strong; border-right: 1px solid $line-strong; height: 100%;
    small { font: 10px $font-mono; letter-spacing: 0.1em; color: $text-tertiary; }
}
.guide-toolbar__now, .guide-toolbar__scope {
    display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 999px;
    border: 1px solid $line-strong; background: transparent; color: $text-primary; font-size: 12.5px; font-weight: 500;
    cursor: pointer; white-space: nowrap;
    &:hover { background: $surface-2; }
    &:focus-visible { outline: 2px solid $accent-blue; outline-offset: 1px; }
}
.guide-toolbar__now { border-color: $accent-blue; color: $accent-text; background: var(--app-selection-surface);
    &::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: $accent-live; box-shadow: 0 0 0 3px color-mix(in srgb, $accent-live 20%, transparent); }
}
.guide-toolbar__scope mat-icon { width: 18px; height: 18px; font-size: 18px; margin-right: -6px; }
.guide-toolbar__toggle {
    display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer; white-space: nowrap;
    input { position: absolute; opacity: 0; width: 0; height: 0; }
    i { width: 30px; height: 16px; border-radius: 99px; background: $surface-3; position: relative; transition: background 120ms;
        &::after { content: ''; position: absolute; left: 2px; top: 2px; width: 12px; height: 12px; border-radius: 50%; background: $text-tertiary; transition: left 120ms, background 120ms; } }
    &.is-on i { background: $accent-blue; &::after { left: 16px; background: var(--app-content-bg); } }
    &:has(input:disabled) { opacity: 0.5; cursor: default; }
    &:has(input:focus-visible) i { outline: 2px solid $accent-blue; outline-offset: 2px; }
}
.guide-toolbar__zoom { display: inline-flex; align-items: center; gap: 8px; color: $text-secondary;
    input[type='range'] { width: 110px; accent-color: $accent-blue; } }
.guide-toolbar__spacer { flex: 1; min-width: 8px; }
.guide-toolbar__input {
    display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 4px 0 10px; width: 190px;
    border: 1px solid $line-strong; border-radius: 8px; background: $surface-1; color: $text-tertiary;
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    input { flex: 1; min-width: 0; border: 0; background: transparent; color: $text-primary; font-size: 12px; outline: none;
        &::placeholder { color: $text-tertiary; } }
    button { width: 24px; height: 24px; padding: 0; mat-icon { font-size: 14px; } }
    &:focus-within { border-color: $accent-blue; }
}
.guide-toolbar__input--search { width: 230px; }
.guide-toolbar__count { font: 10.5px $font-mono; color: $text-tertiary; white-space: nowrap; }
```

Add to the same file, outside `:host` scoping, `::ng-deep .guide-toolbar__scope-menu { max-height: 60vh; .is-selected { color: var(--app-selection-color); font-weight: 600; } }` (CDK menus render outside the component).

- [ ] **Step 4: Row component**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide-row.component.ts
import { DatePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import {
    buildGuideRowBlocks,
    EPG_GUIDE_ZOOM_DEFAULT,
    EpgGuideDayAxis,
    EpgGuideDensity,
    guideTrackWidthPx,
} from './epg-guide-layout.util';
import { EpgGuideRowStatus } from './epg-guide-programs.service';
import { EpgGuideChannel } from './epg-guide-source';

/**
 * One channel row: the sticky channel cell and the lane with positioned
 * programme cards. Layout is recomputed only when its own inputs change, so a
 * 2000-row guide re-lays-out one row per programme batch, not the grid.
 */
@Component({
    selector: 'app-epg-guide-row',
    imports: [DatePipe, MatIconModule, MatTooltipModule, TranslatePipe],
    templateUrl: './epg-guide-row.component.html',
    styleUrl: './epg-guide-row.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'epg-guide-row',
        '[class.is-active]': 'active()',
        '[class.is-focused]': 'rowFocused()',
        '[class.is-compact]': 'density() === "compact"',
    },
})
export class EpgGuideRowComponent {
    readonly channel = input.required<EpgGuideChannel>();
    readonly programs = input<EpgProgram[]>([]);
    readonly status = input<EpgGuideRowStatus>('idle');
    readonly axis = input.required<EpgGuideDayAxis>();
    readonly hourWidthPx = input(EPG_GUIDE_ZOOM_DEFAULT);
    readonly nowMs = input(0);
    readonly offsetMinutes = input(0);
    readonly catchUpAvailable = input(false);
    readonly active = input(false);
    readonly density = input<EpgGuideDensity>('comfortable');
    readonly rowFocused = input(false);
    readonly focusedBlock = input<number | null>(null);

    /** Single click on the channel cell or the on-now card. */
    readonly channelActivated = output<void>();
    /** Double click: activate and close the guide. */
    readonly channelCommitted = output<void>();
    readonly detailsRequested = output<TimelineRenderBlock>();
    readonly watchRequested = output<TimelineRenderBlock>();

    readonly blocks = computed(() =>
        buildGuideRowBlocks(this.programs(), {
            axis: this.axis(),
            hourWidthPx: this.hourWidthPx(),
            nowMs: this.nowMs(),
            offsetMinutes: this.offsetMinutes(),
            catchUpAvailable: this.catchUpAvailable(),
        })
    );
    readonly nowBlock = computed(
        () => this.blocks().find((item) => item.block.when === 'now') ?? null
    );
    readonly trackWidthPx = computed(() => guideTrackWidthPx(this.hourWidthPx()));
    readonly showEmpty = computed(
        () =>
            this.status() === 'none' ||
            (this.status() === 'loaded' && this.blocks().length === 0)
    );
    readonly isLoading = computed(() => this.status() === 'loading');

    onBlockClick(item: TimelineRenderBlock): void {
        if (item.block.when === 'now') {
            this.channelActivated.emit();
        } else {
            this.detailsRequested.emit(item);
        }
    }

    onBlockDoubleClick(item: TimelineRenderBlock): void {
        if (item.block.when === 'now') {
            this.channelCommitted.emit();
        }
    }

    onWatchClick(event: Event, item: TimelineRenderBlock): void {
        event.stopPropagation();
        this.watchRequested.emit(item);
    }
}
```

```html
<!-- libs/ui/epg/src/lib/epg-guide/epg-guide-row.component.html -->
<div
    class="epg-guide-row__channel"
    role="button"
    tabindex="-1"
    [attr.aria-label]="channel().name"
    [attr.aria-pressed]="active()"
    (click)="channelActivated.emit()"
    (dblclick)="channelCommitted.emit()"
>
    <span class="epg-guide-row__num">{{ channel().number }}</span>
    <span class="epg-guide-row__logo">
        @if (channel().logoUrl; as logo) {
            <img [src]="logo" alt="" loading="lazy" />
        } @else {
            <mat-icon>live_tv</mat-icon>
        }
    </span>
    <span class="epg-guide-row__name">
        <b>{{ channel().name }}</b>
        @if (density() === 'comfortable') {
            <small>
                @if (active()) {
                    ▶ {{ 'EPG.GUIDE.PLAYING' | translate }}
                } @else if (nowBlock(); as now) {
                    {{ now.block.program.title }}
                } @else if (showEmpty()) {
                    {{ 'EPG.GUIDE.NO_PROGRAMME_INFO' | translate }}
                }
            </small>
        }
    </span>
    @if (active()) {
        <mat-icon class="epg-guide-row__playing">equalizer</mat-icon>
    }
</div>

<div class="epg-guide-row__lane" [style.width.px]="trackWidthPx()">
    @if (showEmpty()) {
        <span class="epg-guide-row__empty">{{ 'EPG.GUIDE.NO_PROGRAMME_INFO_LONG' | translate }}</span>
    } @else if (isLoading()) {
        <span class="epg-guide-row__skeleton" style="left: 24px; width: 180px"></span>
        <span class="epg-guide-row__skeleton" style="left: 220px; width: 260px"></span>
        <span class="epg-guide-row__skeleton" style="left: 500px; width: 200px"></span>
    }
    @for (item of blocks(); track item.key; let index = $index) {
        <div
            class="epg-guide-row__block"
            role="button"
            tabindex="-1"
            [attr.data-tier]="item.tier"
            [class.is-past]="item.block.when === 'past'"
            [class.is-now]="item.block.when === 'now'"
            [class.is-future]="item.block.when === 'future'"
            [class.is-playing]="active() && item.block.when === 'now'"
            [class.is-focused]="focusedBlock() === index"
            [style.left.px]="item.leftPx"
            [style.width.px]="item.widthPx"
            [matTooltip]="item.tier === 'micro' || item.tier === 'narrow' ? item.block.program.title : ''"
            [attr.aria-label]="item.block.program.title"
            (click)="onBlockClick(item)"
            (dblclick)="onBlockDoubleClick(item)"
        >
            @if (item.block.when === 'now') {
                <span class="epg-guide-row__fill" [style.width.%]="item.nowFillPercent"></span>
            }
            <span class="epg-guide-row__time">
                {{ item.block.startMs | date: 'HH:mm' }}
                @if (density() === 'comfortable') { – {{ item.block.stopMs | date: 'HH:mm' }} }
            </span>
            <span class="epg-guide-row__title">{{ item.block.program.title }}</span>
            @if (item.block.when === 'now') {
                <span class="epg-guide-row__tag">{{ 'EPG.TIMELINE.ON_NOW' | translate }}</span>
            }
            @if (item.canCatchUp && item.block.when === 'past') {
                <button type="button" class="epg-guide-row__watch" (click)="onWatchClick($event, item)"
                    [attr.aria-label]="'EPG.TIMELINE.WATCH' | translate">
                    <mat-icon>replay</mat-icon>
                </button>
            }
        </div>
    }
</div>
```

```scss
// libs/ui/epg/src/lib/epg-guide/epg-guide-row.component.scss
@use '../epg-theme' as *;

:host {
    display: flex; height: 100%; box-sizing: border-box; border-bottom: 1px solid $line;
    background: var(--app-content-bg);
    &:hover { background: $surface-3; }
    &.is-active { background: var(--app-selection-surface); }
    &.is-focused { box-shadow: inset 0 0 0 2px $accent-blue; }
}
.epg-guide-row__channel {
    position: sticky; left: 0; z-index: 2; flex: 0 0 var(--epg-guide-channel-col, 232px);
    display: flex; align-items: center; gap: 10px; padding: 0 12px 0 14px; box-sizing: border-box;
    background: inherit; border-right: 1px solid $line-strong; cursor: pointer; color: $text-primary;
    :host.is-active &::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 3px 3px 0; background: $accent-blue; }
}
.epg-guide-row__num { width: 22px; text-align: right; font: 11px $font-mono; color: $text-tertiary; font-variant-numeric: tabular-nums; }
.epg-guide-row__logo {
    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 8px; overflow: hidden; display: grid; place-items: center;
    background: $surface-1; border: 1px solid $line; color: $text-tertiary;
    img { width: 100%; height: 100%; object-fit: contain; }
    mat-icon { font-size: 18px; width: 18px; height: 18px; }
    :host.is-compact & { width: 26px; height: 26px; border-radius: 6px; }
}
.epg-guide-row__name {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
    b { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    small { font-size: 10.5px; color: $text-tertiary; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :host.is-active & small { color: $accent-text; }
}
.epg-guide-row__playing { color: $accent-blue; font-size: 18px; width: 18px; height: 18px; }
.epg-guide-row__lane { position: relative; flex: 0 0 auto; height: 100%; }
.epg-guide-row__empty { position: absolute; left: 14px; top: 0; bottom: 0; display: flex; align-items: center; font-size: 12px; font-style: italic; color: $text-tertiary; }
.epg-guide-row__skeleton { position: absolute; top: 9px; bottom: 9px; border-radius: 8px; background: $surface-2; opacity: 0.6; }
.epg-guide-row__block {
    position: absolute; top: 7px; bottom: 7px; box-sizing: border-box; border-radius: 8px; padding: 6px 10px;
    border: 1px solid $line-strong; background: $surface-1; color: $text-primary; cursor: pointer; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0;
    transition: border-color 120ms, transform 120ms;
    &:hover { border-color: $accent-blue; transform: translateY(-1px); z-index: 3; }
    &.is-focused { outline: 2px solid $accent-blue; outline-offset: 1px; z-index: 3; }
    &.is-past { background: transparent; border-color: $line; .epg-guide-row__title { color: $text-secondary; font-weight: 400; } }
    &.is-now { background: var(--app-selection-surface); border-color: $accent-blue; .epg-guide-row__title { font-weight: 600; } }
    &.is-playing { background: var(--app-selection-surface-strong); }
    &[data-tier='narrow'] { padding: 6px 8px; .epg-guide-row__time, .epg-guide-row__tag { display: none; } }
    &[data-tier='micro'] { padding: 0; border-radius: 4px; .epg-guide-row__time, .epg-guide-row__title, .epg-guide-row__tag { display: none; } }
    :host.is-compact & { top: 5px; bottom: 5px; flex-direction: row; align-items: center; gap: 8px; border-radius: 6px; padding: 0 9px; }
}
.epg-guide-row__fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, $accent-blue 14%, transparent); pointer-events: none; }
.epg-guide-row__time { position: relative; font: 10.5px $font-mono; color: $text-secondary; white-space: nowrap; font-variant-numeric: tabular-nums; }
.epg-guide-row__title { position: relative; font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.epg-guide-row__tag { position: absolute; right: 8px; top: 7px; font: 600 9px $font-mono; letter-spacing: 0.1em; text-transform: uppercase; color: $accent-text;
    &::before { content: ''; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: $accent-live; margin-right: 4px; vertical-align: 1px; }
    :host.is-compact & { position: static; margin-left: auto; } }
.epg-guide-row__watch { position: absolute; right: 6px; bottom: 5px; width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: $text-secondary; cursor: pointer;
    mat-icon { font-size: 16px; width: 16px; height: 16px; } &:hover { color: $accent-text; } }
```

- [ ] **Step 5: Guide shell component**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide.component.ts
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import {
    afterNextRender,
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    effect,
    HostListener,
    inject,
    OnDestroy,
    OnInit,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ListRange } from '@angular/cdk/collections';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram, epgProviderClockMs } from '@iptvnator/shared/interfaces';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    EpgDateNavigationDirection,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '../epg-date';
import { EpgItemDialogAction } from '../epg-item-description/epg-item-description.component';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import { EpgGuideKeyboardController } from './epg-guide-keyboard.controller';
import {
    buildGuideDayAxis,
    buildGuideRowBlocks,
    buildGuideTicks,
    EPG_GUIDE_CHANNEL_COLUMN_PX,
    EPG_GUIDE_ROW_BUFFER,
    EPG_GUIDE_ROW_HEIGHT_PX,
    EpgGuideDensity,
    guideNowLeftPx,
    guideTrackWidthPx,
} from './epg-guide-layout.util';
import {
    clampGuideZoom,
    persistEpgGuidePreferences,
    restoreEpgGuidePreferences,
} from './epg-guide-preferences';
import { EpgGuideProgramsService } from './epg-guide-programs.service';
import { EpgGuideRowComponent } from './epg-guide-row.component';
import { EPG_GUIDE_SOURCE, EpgGuideChannel } from './epg-guide-source';
import { EpgGuideToolbarComponent } from './epg-guide-toolbar.component';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_RESULTS = 20;

/**
 * Multi-channel programme guide. Reads everything from `EPG_GUIDE_SOURCE`;
 * owns the selected day, zoom, density, filters and keyboard navigation.
 * Rows are virtualised; the channel column and the ruler are sticky.
 */
@Component({
    selector: 'app-epg-guide',
    imports: [
        DatePipe,
        MatButtonModule,
        MatIconModule,
        ScrollingModule,
        TranslatePipe,
        EpgGuideRowComponent,
        EpgGuideToolbarComponent,
    ],
    providers: [EpgGuideProgramsService],
    templateUrl: './epg-guide.component.html',
    styleUrl: './epg-guide.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgGuideComponent implements OnInit, OnDestroy {
    private readonly source = inject(EPG_GUIDE_SOURCE);
    private readonly programsService = inject(EpgGuideProgramsService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly programmeDialog = inject(EpgProgrammeDialogService);
    private readonly dialog = inject(MatDialog);
    private readonly translate = inject(TranslateService);
    private readonly destroyRef = inject(DestroyRef);

    readonly close = output<void>();
    readonly channelActivated = output<string>();

    readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');

    private readonly preferences = restoreEpgGuidePreferences();
    readonly dayKey = signal(getTodayEpgDateKey());
    readonly zoom = signal(this.preferences.zoom);
    readonly density = signal<EpgGuideDensity>(this.preferences.density);
    readonly onlyWithEpg = signal(this.preferences.onlyWithEpg);
    readonly filter = signal('');
    readonly searchQuery = signal('');
    readonly searchResults = signal<EpgProgram[]>([]);
    readonly nowMs = signal(Date.now());
    readonly scrollLeft = signal(0);

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    readonly currentLocale = computed(() => {
        this.languageTick();
        return this.translate.currentLang || this.translate.defaultLang || 'en';
    });
    readonly offsetMinutes = this.settingsStore.resolvedEpgOffsetMinutes;
    readonly scopes = this.source.scopes;
    readonly scopeId = this.source.scopeId;
    readonly activeChannelId = this.source.activeChannelId;
    readonly coverageLoaded = this.programsService.coverageLoaded;
    readonly searchEnabled = typeof this.source.searchPrograms === 'function';
    readonly catchUpAvailable = this.source.catchUp !== undefined;
    readonly channelColumnPx = EPG_GUIDE_CHANNEL_COLUMN_PX;

    readonly axis = computed(() => buildGuideDayAxis(this.dayKey()));
    readonly isToday = computed(() => {
        this.nowMs();
        return this.dayKey() === getTodayEpgDateKey();
    });
    readonly ticks = computed(() => buildGuideTicks(this.axis(), this.zoom()));
    readonly trackWidthPx = computed(() => guideTrackWidthPx(this.zoom()));
    readonly nowLeftPx = computed(() =>
        guideNowLeftPx(this.axis(), this.nowMs(), this.zoom())
    );
    readonly rowHeightPx = computed(() => EPG_GUIDE_ROW_HEIGHT_PX[this.density()]);
    readonly totalCount = computed(() => this.source.channels().length);
    readonly rows = computed(() => {
        const needle = this.filter().trim().toLowerCase();
        const onlyWithEpg = this.onlyWithEpg();
        return this.source
            .channels()
            .filter(
                (channel) =>
                    (!needle || channel.name.toLowerCase().includes(needle)) &&
                    (!onlyWithEpg || this.programsService.isCovered(channel.id))
            );
    });
    readonly activeRowIndex = computed(() => {
        const activeId = this.activeChannelId();
        return activeId === null
            ? -1
            : this.rows().findIndex((channel) => channel.id === activeId);
    });

    private readonly keyboard = new EpgGuideKeyboardController({
        rowCount: () => this.rows().length,
        blockCount: (row) => this.blocksFor(row).length,
        activeRow: () => this.activeRowIndex(),
        isBlocked: () => this.dialog.openDialogs.length > 0,
        play: (row) => this.commitRow(this.rows()[row]),
        details: (row, block) =>
            this.openDetails(this.rows()[row], this.blocksFor(row)[block]),
        jumpNow: () => this.jumpNow(),
        stepDay: (direction) => this.stepDay(direction),
        close: () => this.close.emit(),
    });
    readonly focus = this.keyboard.focus;

    private renderedRange: ListRange | null = null;
    private minuteTimer?: number;
    private searchTimer?: number;

    constructor() {
        effect(() => {
            const axis = this.axis();
            const offset = this.offsetMinutes();
            this.programsService.setWindow(
                epgProviderClockMs(axis.startMs, offset),
                epgProviderClockMs(axis.endMs, offset)
            );
            untracked(() => this.loadRenderedRange());
        });
        effect(() => {
            this.rows();
            untracked(() => this.loadRenderedRange());
        });
        effect(() =>
            persistEpgGuidePreferences({
                density: this.density(),
                zoom: this.zoom(),
                onlyWithEpg: this.onlyWithEpg(),
            })
        );
        effect(() => {
            const viewport = this.viewport();
            if (!viewport) {
                return;
            }
            untracked(() =>
                viewport.renderedRangeStream
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe((range) => {
                        this.renderedRange = range;
                        this.loadRenderedRange();
                    })
            );
        });
        afterNextRender(() => this.jumpNow(false));
    }

    ngOnInit(): void {
        this.minuteTimer = window.setInterval(
            () => this.nowMs.set(Date.now()),
            60_000
        );
    }

    ngOnDestroy(): void {
        window.clearInterval(this.minuteTimer);
        window.clearTimeout(this.searchTimer);
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent): void {
        if (this.keyboard.handle(event)) {
            event.preventDefault();
            this.revealFocus();
        }
    }

    trackRow(_index: number, channel: EpgGuideChannel): string {
        return `${channel.number}:${channel.id}`;
    }

    programsFor(channelId: string): EpgProgram[] {
        return this.programsService.programsFor(channelId);
    }

    statusFor(channelId: string) {
        return this.programsService.statusFor(channelId);
    }

    focusedBlockFor(row: number): number | null {
        const focused = this.focus();
        return focused?.row === row ? focused.block : null;
    }

    onViewportScroll(event: Event): void {
        this.scrollLeft.set((event.target as HTMLElement).scrollLeft);
    }

    stepDay(direction: EpgDateNavigationDirection): void {
        this.dayKey.set(shiftEpgDateKey(this.dayKey(), direction));
        this.focus.set(null);
    }

    jumpNow(animate = true): void {
        this.dayKey.set(getTodayEpgDateKey());
        this.nowMs.set(Date.now());
        const viewport = this.viewport();
        const nowX = this.nowLeftPx();
        if (!viewport || nowX === null) {
            return;
        }
        const element = viewport.elementRef.nativeElement;
        const visibleTrack = Math.max(0, element.clientWidth - this.channelColumnPx);
        element.scrollTo({
            left: Math.max(0, nowX - visibleTrack / 3),
            behavior: animate ? 'smooth' : 'auto',
        });
        const activeRow = this.activeRowIndex();
        if (activeRow >= 0) {
            viewport.scrollToIndex(Math.max(0, activeRow - 3), animate ? 'smooth' : 'auto');
        }
    }

    setScope(scopeId: string): void {
        this.source.setScope(scopeId);
        this.focus.set(null);
    }

    setOnlyWithEpg(value: boolean): void {
        this.onlyWithEpg.set(value);
    }

    setDensity(value: EpgGuideDensity): void {
        this.density.set(value);
    }

    setZoom(value: number): void {
        this.zoom.set(clampGuideZoom(value));
    }

    setFilter(value: string): void {
        this.filter.set(value);
        this.focus.set(null);
    }

    onSearchQueryChange(query: string): void {
        this.searchQuery.set(query);
        window.clearTimeout(this.searchTimer);
        const term = query.trim();
        if (term.length < 2 || !this.source.searchPrograms) {
            this.searchResults.set([]);
            return;
        }
        this.searchTimer = window.setTimeout(async () => {
            const results = await this.source.searchPrograms?.(term).catch(() => []);
            if (this.searchQuery() === query) {
                this.searchResults.set((results ?? []).slice(0, SEARCH_MAX_RESULTS));
            }
        }, SEARCH_DEBOUNCE_MS);
    }

    openSearchResult(program: EpgProgram): void {
        this.programmeDialog.open({ ...program }).subscribe();
    }

    activateRow(channel: EpgGuideChannel | undefined): void {
        if (!channel) {
            return;
        }
        this.source.activate(channel.id);
        this.channelActivated.emit(channel.id);
    }

    commitRow(channel: EpgGuideChannel | undefined): void {
        if (!channel) {
            return;
        }
        this.activateRow(channel);
        this.close.emit();
    }

    openDetails(
        channel: EpgGuideChannel | undefined,
        item: TimelineRenderBlock | undefined
    ): void {
        if (!channel || !item) {
            return;
        }
        const when = item.block.when;
        this.programmeDialog
            .open({
                ...item.block.program,
                channelName: channel.name,
                channelLogo: channel.logoUrl,
                primaryAction:
                    when === 'now' ? 'live' : item.canCatchUp ? 'timeshift' : null,
                archiveUnavailableNote: when === 'past' && !item.canCatchUp,
            })
            .subscribe((result: EpgItemDialogAction | undefined) => {
                if (result === 'live') {
                    this.activateRow(channel);
                } else if (result === 'timeshift') {
                    this.source.catchUp?.watch(channel, item.block.program);
                }
            });
    }

    watch(channel: EpgGuideChannel, item: TimelineRenderBlock): void {
        this.source.catchUp?.watch(channel, item.block.program);
    }

    private blocksFor(row: number): TimelineRenderBlock[] {
        const channel = this.rows()[row];
        if (!channel) {
            return [];
        }
        return buildGuideRowBlocks(this.programsService.programsFor(channel.id), {
            axis: this.axis(),
            hourWidthPx: this.zoom(),
            nowMs: this.nowMs(),
            offsetMinutes: this.offsetMinutes(),
            catchUpAvailable: this.catchUpAvailable,
        });
    }

    private loadRenderedRange(): void {
        const rows = this.rows();
        const range = this.renderedRange ?? { start: 0, end: Math.min(rows.length, 30) };
        const start = Math.max(0, range.start - EPG_GUIDE_ROW_BUFFER);
        const end = Math.min(rows.length, range.end + EPG_GUIDE_ROW_BUFFER);
        this.programsService.ensureLoaded(rows.slice(start, end));
    }

    /** Keep the keyboard focus target inside the viewport, both axes. */
    private revealFocus(): void {
        const focused = this.focus();
        const viewport = this.viewport();
        if (!focused || !viewport) {
            return;
        }
        const element = viewport.elementRef.nativeElement;
        const rowTop = focused.row * this.rowHeightPx();
        const scrollTop = viewport.measureScrollOffset('top');
        if (rowTop < scrollTop || rowTop + this.rowHeightPx() > scrollTop + element.clientHeight) {
            viewport.scrollToIndex(Math.max(0, focused.row - 2));
        }
        if (focused.block !== null) {
            const block = this.blocksFor(focused.row)[focused.block];
            if (!block) {
                return;
            }
            const visibleLeft = element.scrollLeft;
            const visibleWidth = element.clientWidth - this.channelColumnPx;
            if (block.leftPx < visibleLeft || block.leftPx + block.widthPx > visibleLeft + visibleWidth) {
                element.scrollTo({ left: Math.max(0, block.leftPx - 40), behavior: 'smooth' });
            }
        }
    }
}
```

If this file exceeds 300 lines after formatting, move `jumpNow`/`revealFocus` scrolling into `epg-guide-scroll.util.ts` as pure functions taking the viewport element and geometry — do not let it reach 400.

```html
<!-- libs/ui/epg/src/lib/epg-guide/epg-guide.component.html -->
<app-epg-guide-toolbar
    [dayMs]="axis().startMs"
    [isToday]="isToday()"
    [currentLocale]="currentLocale()"
    [scopes]="scopes()"
    [scopeId]="scopeId()"
    [onlyWithEpg]="onlyWithEpg()"
    [coverageLoaded]="coverageLoaded()"
    [density]="density()"
    [zoom]="zoom()"
    [filter]="filter()"
    [searchEnabled]="searchEnabled"
    [searchQuery]="searchQuery()"
    [shownCount]="rows().length"
    [totalCount]="totalCount()"
    (stepDay)="stepDay($event)"
    (jumpNow)="jumpNow()"
    (scopeChange)="setScope($event)"
    (onlyWithEpgChange)="setOnlyWithEpg($event)"
    (densityChange)="setDensity($event)"
    (zoomChange)="setZoom($event)"
    (filterChange)="setFilter($event)"
    (searchQueryChange)="onSearchQueryChange($event)"
/>

@if (searchEnabled && searchQuery().trim().length >= 2) {
    <div class="epg-guide__search-results" role="listbox">
        @for (program of searchResults(); track program.channel + program.start) {
            <button type="button" class="epg-guide__search-result" role="option" (click)="openSearchResult(program)">
                <span class="epg-guide__search-title">{{ program.title }}</span>
                <span class="epg-guide__search-meta">
                    {{ program.start | date: 'EEE d MMM HH:mm' : '' : currentLocale() }} · {{ program.channel }}
                </span>
            </button>
        } @empty {
            <div class="epg-guide__search-empty">{{ 'EPG.GUIDE.NO_RESULTS' | translate }}</div>
        }
    </div>
}

<div class="epg-guide__grid" [style.--epg-guide-channel-col.px]="channelColumnPx">
    <div class="epg-guide__ruler">
        <div class="epg-guide__corner">{{ 'EPG.GUIDE.CHANNEL' | translate }}</div>
        <div class="epg-guide__ruler-clip">
            <div class="epg-guide__ruler-track" [style.width.px]="trackWidthPx()"
                [style.transform]="'translateX(' + -scrollLeft() + 'px)'">
                @for (tick of ticks(); track tick.ms) {
                    <div class="epg-guide__tick" [class.is-half]="tick.kind === 'half'" [style.left.px]="tick.leftPx">
                        {{ tick.ms | date: 'HH:mm' }}
                    </div>
                }
                @if (nowLeftPx(); as nowX) {
                    <div class="epg-guide__now-badge" [style.left.px]="nowX">{{ nowMs() | date: 'HH:mm' }}</div>
                }
            </div>
        </div>
    </div>

    <cdk-virtual-scroll-viewport
        #viewport
        class="epg-guide__viewport"
        [itemSize]="rowHeightPx()"
        [minBufferPx]="rowHeightPx() * 6"
        [maxBufferPx]="rowHeightPx() * 12"
        (scroll)="onViewportScroll($event)"
    >
        <app-epg-guide-row
            *cdkVirtualFor="let channel of rows(); trackBy: trackRow; let index = index"
            [channel]="channel"
            [programs]="programsFor(channel.id)"
            [status]="statusFor(channel.id)"
            [axis]="axis()"
            [hourWidthPx]="zoom()"
            [nowMs]="nowMs()"
            [offsetMinutes]="offsetMinutes()"
            [catchUpAvailable]="catchUpAvailable"
            [active]="channel.id === activeChannelId()"
            [density]="density()"
            [rowFocused]="focus()?.row === index"
            [focusedBlock]="focusedBlockFor(index)"
            [style.height.px]="rowHeightPx()"
            (channelActivated)="activateRow(channel)"
            (channelCommitted)="commitRow(channel)"
            (detailsRequested)="openDetails(channel, $event)"
            (watchRequested)="watch(channel, $event)"
        />
        @if (rows().length === 0) {
            <div class="epg-guide__no-rows">
                <mat-icon>search_off</mat-icon>
                <p>{{ 'EPG.GUIDE.NO_CHANNELS' | translate: { query: filter() } }}</p>
                @if (filter()) {
                    <button type="button" mat-button (click)="setFilter('')">{{ 'EPG.GUIDE.CLEAR_FILTER' | translate }}</button>
                }
            </div>
        }
    </cdk-virtual-scroll-viewport>

    @if (nowLeftPx(); as nowX) {
        <div class="epg-guide__now-line" [style.left.px]="channelColumnPx + nowX - scrollLeft()"></div>
    }
</div>

<div class="epg-guide__keys" aria-hidden="true">
    <span><kbd>↑</kbd><kbd>↓</kbd>{{ 'EPG.GUIDE.KEYS.CHANNEL' | translate }}</span>
    <span><kbd>←</kbd><kbd>→</kbd>{{ 'EPG.GUIDE.KEYS.PROGRAMME' | translate }}</span>
    <span><kbd>Enter</kbd>{{ 'EPG.GUIDE.KEYS.PLAY' | translate }}</span>
    <span><kbd>I</kbd>{{ 'EPG.GUIDE.KEYS.DETAILS' | translate }}</span>
    <span><kbd>N</kbd>{{ 'EPG.GUIDE.KEYS.NOW' | translate }}</span>
    <span><kbd>PgUp</kbd><kbd>PgDn</kbd>{{ 'EPG.GUIDE.KEYS.DAY' | translate }}</span>
    <span><kbd>Esc</kbd>{{ 'EPG.GUIDE.KEYS.CLOSE' | translate }}</span>
</div>
```

```scss
// libs/ui/epg/src/lib/epg-guide/epg-guide.component.scss
@use '../epg-theme' as *;

:host { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--app-content-bg); color: $text-primary; position: relative; }
.epg-guide__grid { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.epg-guide__ruler { display: flex; height: 34px; flex: 0 0 auto; border-bottom: 1px solid $line-strong; background: var(--app-content-bg); z-index: 4; }
.epg-guide__corner { flex: 0 0 var(--epg-guide-channel-col); display: flex; align-items: center; padding: 0 14px; font: 500 10px $font-mono; letter-spacing: 0.1em; text-transform: uppercase; color: $text-tertiary; border-right: 1px solid $line-strong; box-sizing: border-box; }
.epg-guide__ruler-clip { flex: 1; overflow: hidden; position: relative; }
.epg-guide__ruler-track { position: relative; height: 100%; will-change: transform; }
.epg-guide__tick { position: absolute; top: 0; bottom: 0; padding-left: 8px; display: flex; align-items: center; border-left: 1px solid $line-strong; font: 11px $font-mono; color: $text-secondary; font-variant-numeric: tabular-nums;
    &.is-half { border-left-color: $line; color: $text-tertiary; font-size: 10px; } }
.epg-guide__now-badge { position: absolute; top: 6px; transform: translateX(-50%); background: $accent-live; color: #1a0d0d; font: 600 10.5px $font-mono; padding: 3px 7px; border-radius: 5px; z-index: 5; font-variant-numeric: tabular-nums; }
.epg-guide__viewport { flex: 1; min-height: 0; overflow: auto;
    ::ng-deep .cdk-virtual-scroll-content-wrapper { min-width: 100%; } }
.epg-guide__now-line { position: absolute; top: 34px; bottom: 0; width: 2px; background: $accent-live; box-shadow: 0 0 10px color-mix(in srgb, $accent-live 60%, transparent); pointer-events: none; z-index: 3; }
.epg-guide__no-rows { position: sticky; left: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; color: $text-tertiary;
    mat-icon { font-size: 32px; width: 32px; height: 32px; } }
.epg-guide__keys { display: flex; align-items: center; gap: 18px; height: 34px; padding: 0 18px; border-top: 1px solid $line; font-size: 11px; color: $text-tertiary; flex: 0 0 auto;
    kbd { font: 10px $font-mono; color: $text-secondary; border: 1px solid $line-strong; border-radius: 4px; padding: 1px 5px; margin-right: 5px; } }
.epg-guide__search-results { position: absolute; top: 52px; right: 18px; width: 420px; max-height: 50vh; overflow: auto; z-index: 20; background: $surface-1; border: 1px solid $line-strong; border-radius: 10px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35); padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.epg-guide__search-result { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; color: $text-primary; cursor: pointer; font: inherit;
    &:hover, &:focus-visible { background: $surface-3; outline: none; } }
.epg-guide__search-title { font-size: 13px; font-weight: 500; }
.epg-guide__search-meta { font: 10.5px $font-mono; color: $text-tertiary; }
.epg-guide__search-empty { padding: 14px; text-align: center; color: $text-tertiary; font-size: 12.5px; }
```

- [ ] **Step 6: Export from the library**

In `libs/ui/epg/src/index.ts` add (keep the two `multi-epg` lines for now; Task 10 removes them):

```ts
export * from './lib/epg-guide/epg-guide-source';
export * from './lib/epg-guide/epg-guide-layout.util';
export * from './lib/epg-guide/epg-guide-preferences';
export * from './lib/epg-guide/epg-guide.component';
export * from './lib/epg-guide/epg-guide-now-playing.component';
```

- [ ] **Step 7: Write the failing component spec**

```ts
// libs/ui/epg/src/lib/epg-guide/epg-guide.component.spec.ts
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { EpgGuideComponent } from './epg-guide.component';
import {
    EPG_GUIDE_DENSITY_KEY,
    EPG_GUIDE_ONLY_WITH_EPG_KEY,
} from './epg-guide-preferences';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideSource,
} from './epg-guide-source';

function channel(id: string, epgKey: string | null = id, number = 1): EpgGuideChannel {
    return { id, number, name: `Channel ${id}`, logoUrl: null, epgKey };
}

function nowProgram(channelId: string): EpgProgram {
    const start = new Date(Date.now() - 10 * 60_000);
    const stop = new Date(Date.now() + 20 * 60_000);
    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        channel: channelId,
        title: `${channelId} now`,
        desc: null,
        category: null,
    };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
}

describe('EpgGuideComponent', () => {
    let fixture: ComponentFixture<EpgGuideComponent>;
    let component: EpgGuideComponent;
    const channels = signal<EpgGuideChannel[]>([]);
    const activeChannelId = signal<string | null>(null);
    const activate = jest.fn();
    const setScope = jest.fn();
    const dialogOpen = jest.fn(() => of(undefined));

    beforeEach(() => {
        localStorage.clear();
        activate.mockReset();
        setScope.mockReset();
        dialogOpen.mockClear();
        channels.set([channel('a', 'a', 1), channel('b', null, 2), channel('c', 'c', 3)]);
        activeChannelId.set('a');
        const source: EpgGuideSource = {
            channels,
            scopes: signal([{ id: 'all', label: 'All channels', kind: 'all' }]),
            scopeId: signal('all'),
            setScope,
            loadPrograms: async (window) =>
                new Map(window.channels.map((item) => [item.id, item.id === 'a' ? [nowProgram('a')] : []])),
            loadCoverage: async () => new Set(['a']),
            activeChannelId,
            activate,
        };
        TestBed.configureTestingModule({
            imports: [EpgGuideComponent],
            providers: [
                { provide: EPG_GUIDE_SOURCE, useValue: source },
                { provide: EpgProgrammeDialogService, useValue: { open: dialogOpen } },
                { provide: MatDialog, useValue: { openDialogs: [] } },
                { provide: SettingsStore, useValue: { resolvedEpgOffsetMinutes: signal(0) } },
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: new BehaviorSubject(null),
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                    },
                },
            ],
        });
        fixture = TestBed.createComponent(EpgGuideComponent);
        component = fixture.componentInstance;
    });

    it('lists the scope channels in order and marks the active one', async () => {
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['a', 'b', 'c']);
        expect(component.activeRowIndex()).toBe(0);
    });

    it('emits activate on click and activate + close on double click / Enter', async () => {
        await settle(fixture);
        const close = jest.fn();
        component.close.subscribe(close);
        component.activateRow(component.rows()[2]);
        expect(activate).toHaveBeenCalledWith('c');
        expect(close).not.toHaveBeenCalled();
        component.commitRow(component.rows()[2]);
        expect(close).toHaveBeenCalledTimes(1);
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(activate).toHaveBeenLastCalledWith('a');
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('hides only uncovered rows when "Only with EPG" is on, after coverage arrived', async () => {
        await settle(fixture);
        component.setOnlyWithEpg(true);
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['a']);
        expect(localStorage.getItem(EPG_GUIDE_ONLY_WITH_EPG_KEY)).toBe('1');
    });

    it('filters by channel name and clears', async () => {
        await settle(fixture);
        component.setFilter('channel c');
        expect(component.rows().map((row) => row.id)).toEqual(['c']);
        component.setFilter('');
        expect(component.rows()).toHaveLength(3);
    });

    it('persists density and zoom and restores them', async () => {
        await settle(fixture);
        component.setDensity('compact');
        component.setZoom(9_999);
        await settle(fixture);
        expect(localStorage.getItem(EPG_GUIDE_DENSITY_KEY)).toBe('compact');
        expect(component.zoom()).toBe(480);
        expect(component.rowHeightPx()).toBe(44);
    });

    it('opens the programme dialog for a non-live card and activates on "live"', async () => {
        await settle(fixture);
        dialogOpen.mockReturnValueOnce(of('live'));
        const row = component.rows()[0];
        const item = {
            kind: 'block' as const,
            key: 'k',
            block: {
                program: nowProgram('a'),
                key: 'k',
                startMs: 0,
                stopMs: 1,
                when: 'past' as const,
                offsetMin: 0,
                durationMin: 1,
            },
            leftPx: 0,
            widthPx: 10,
            tier: 'wide' as const,
            nowFillPercent: 0,
            canCatchUp: false,
        };
        component.openDetails(row, item);
        expect(dialogOpen).toHaveBeenCalledWith(
            expect.objectContaining({ channelName: 'Channel a', primaryAction: null, archiveUnavailableNote: true })
        );
        expect(activate).toHaveBeenCalledWith('a');
    });

    it('closes on Escape and steps days with PageUp/PageDown', async () => {
        await settle(fixture);
        const close = jest.fn();
        component.close.subscribe(close);
        const before = component.dayKey();
        component.onKeydown(new KeyboardEvent('keydown', { key: 'PageDown' }));
        expect(component.dayKey()).not.toBe(before);
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(close).toHaveBeenCalled();
        expect(fixture.debugElement.query(By.css('app-epg-guide-toolbar'))).toBeTruthy();
    });
});
```

- [ ] **Step 8: Run the spec**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/ui/epg/src/lib/epg-guide/epg-guide.component.spec.ts`
Expected: PASS (7 tests). If `TranslatePipe` needs more of `TranslateService`, extend the stub the way `epg-timeline.component.spec.ts` does rather than importing the real module. If `afterNextRender` throws in the test environment, wrap the `jumpNow(false)` call in `try/catch`-free guard `if (typeof window !== 'undefined')` — do not remove the auto-scroll.

- [ ] **Step 9: Lint + run the whole ui-epg project**

Run: `pnpm nx lint ui-epg && pnpm nx test ui-epg`
Expected: lint clean (every new file < 400 lines, no bare aliases), all specs PASS.

- [ ] **Step 10: Commit**

```bash
git add libs/ui/epg apps/web/src/assets/i18n/en.json
git commit -m "feat(epg): add the programme guide grid components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: "Guide" button in the timeline toolbar

**Files:**
- Modify: `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.ts:86-115`
- Modify: `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.html:90-125`
- Modify: `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.scss:164-180`
- Modify: `libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.spec.ts`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.spec-stubs.ts`

- [ ] **Step 1: Write the failing spec**

Append to `epg-timeline.component.spec.ts` inside the main `describe`:

```ts
    it('shows a Guide button only when the host offers a guide and emits openGuide', () => {
        setInputs({ programs: [programAt(0, 120, 'Now')] });
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector('.epg-timeline__guide')
        ).toBeNull();

        const openGuide = jest.fn();
        component.openGuide.subscribe(openGuide);
        setInputs({ guideAvailable: true });
        fixture.detectChanges();
        const button = fixture.nativeElement.querySelector(
            '.epg-timeline__guide'
        ) as HTMLButtonElement;
        expect(button).not.toBeNull();
        button.click();
        expect(openGuide).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.spec.ts`
Expected: FAIL — `guideAvailable` is not a known input.

- [ ] **Step 3: Add input, output and button**

In `epg-timeline.component.ts` after `readonly offsetMinutes = input(0);` add:

```ts
    /** The host can open a multi-channel guide; renders the Guide button. */
    readonly guideAvailable = input(false);
```

After `readonly collapsedChange = output<boolean>();` add:

```ts
    readonly openGuide = output<void>();
```

In `epg-timeline.component.html`, inside `@if (showRibbonControls()) {` directly before the `epg-timeline__jump` button, add:

```html
                @if (guideAvailable()) {
                    <button
                        type="button"
                        class="epg-timeline__guide"
                        (click)="openGuide.emit()"
                        [matTooltip]="'EPG.TIMELINE.OPEN_GUIDE' | translate"
                    >
                        <mat-icon>grid_view</mat-icon>
                        {{ 'EPG.TIMELINE.GUIDE' | translate }}
                    </button>
                }
```

In `epg-timeline.component.scss` change the selector `.epg-timeline__jump {` to `.epg-timeline__jump,\n.epg-timeline__guide {` so both share the pill style, and add after that block:

```scss
.epg-timeline__guide {
    color: $accent-text;
    border-color: $accent-blue;
}
```

In `video-player.spec-stubs.ts` add to `StubEpgTimelineComponent`:

```ts
    readonly guideAvailable = input(false);
    readonly openGuide = output<void>();
```

- [ ] **Step 4: Run the timeline spec and the host spec**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/ui/epg/src/lib/epg-timeline/epg-timeline.component.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/ui/epg/src/lib/epg-timeline libs/playlist/m3u/feature-player/src/lib/video-player/video-player.spec-stubs.ts
git commit -m "feat(epg): add a Guide button to the timeline toolbar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: M3U adapter for `EPG_GUIDE_SOURCE`

**Files:**
- Create: `libs/playlist/m3u/feature-player/src/lib/epg-guide/m3u-epg-guide-source.service.ts`
- Create: `libs/playlist/m3u/feature-player/src/lib/epg-guide/m3u-epg-guide-source.service.spec.ts`

The host binds its signals into the adapter (`bind()`), so the adapter has
no dependency on the 1600-line host component and can be unit-tested alone.

- [ ] **Step 1: Write the failing spec**

```ts
// libs/playlist/m3u/feature-player/src/lib/epg-guide/m3u-epg-guide-source.service.spec.ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { ChannelActions } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import { M3uEpgGuideSourceService } from './m3u-epg-guide-source.service';

function makeChannel(
    id: string,
    overrides: Partial<Channel> & { tvgId?: string; group?: string } = {}
): Channel {
    return {
        id,
        url: `https://example.com/${id}.m3u8`,
        name: overrides.name ?? `Channel ${id}`,
        group: { title: overrides.group ?? 'News' },
        tvg: {
            id: overrides.tvgId ?? '',
            name: '',
            url: '',
            logo: overrides.tvg?.logo ?? '',
            rec: '',
        },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: overrides.radio ?? 'false',
    } as Channel;
}

function program(channel: string): EpgProgram {
    return {
        start: '2026-09-06T16:00:00.000Z',
        stop: '2026-09-06T17:00:00.000Z',
        channel,
        title: `${channel} show`,
        desc: null,
        category: null,
    };
}

describe('M3uEpgGuideSourceService', () => {
    const channels = signal<Channel[]>([]);
    const favoriteIds = signal<string[]>([]);
    const activeChannel = signal<Channel | null>(null);
    const dispatch = jest.fn();
    const getProgramsForChannels = jest.fn();
    const getProgramCoverage = jest.fn();
    const searchPrograms = jest.fn();
    let service: M3uEpgGuideSourceService;

    beforeEach(() => {
        dispatch.mockReset();
        getProgramsForChannels.mockReset();
        getProgramCoverage.mockReset();
        searchPrograms.mockReset();
        channels.set([
            makeChannel('a', { tvgId: 'a.tv', group: 'News' }),
            makeChannel('b', { name: 'Beta', group: 'Sports' }),
            makeChannel('c', { name: '   ', group: 'Sports' }),
        ]);
        favoriteIds.set(['b']);
        activeChannel.set(channels()[0]);
        TestBed.configureTestingModule({
            providers: [
                M3uEpgGuideSourceService,
                { provide: Store, useValue: { dispatch } },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: { getProgramsForChannels, getProgramCoverage, searchPrograms },
                },
                { provide: SettingsStore, useValue: { stripCountryPrefix: signal(false) } },
            ],
        });
        service = TestBed.inject(M3uEpgGuideSourceService);
        service.bind({ channels, favoriteIds, activeChannel });
    });

    it('offers all / groups / favorites scopes and lists channels in playlist order', () => {
        expect(service.scopes().map((scope) => scope.id)).toEqual([
            'all',
            'favorites',
            'group:News',
            'group:Sports',
        ]);
        expect(service.channels().map((channel) => channel.number)).toEqual([1, 2, 3]);
        service.setScope('group:Sports');
        expect(service.channels().map((channel) => channel.id)).toEqual(['b', 'c']);
        expect(service.channels()[0].number).toBe(1);
        service.setScope('favorites');
        expect(service.channels().map((channel) => channel.id)).toEqual(['b']);
    });

    it('derives the EPG key from tvg-id, then name, and null for blank names', () => {
        const keys = service.channels().map((channel) => channel.epgKey);
        expect(keys).toEqual(['a.tv', 'Beta', null]);
    });

    it('loads programmes and coverage through the bridge keyed back by channel id', async () => {
        getProgramsForChannels.mockResolvedValue({ 'a.tv': [program('a.tv')], Beta: [] });
        getProgramCoverage.mockResolvedValue(['a.tv']);
        const window = { channels: service.channels(), fromMs: 1, toMs: 2 };

        const programs = await service.loadPrograms(window);
        expect(getProgramsForChannels).toHaveBeenCalledWith({
            channelIds: ['a.tv', 'Beta'],
            fromMs: 1,
            toMs: 2,
        });
        expect(programs.get('a')?.[0].title).toBe('a.tv show');
        expect(programs.get('b')).toEqual([]);
        expect(programs.has('c')).toBe(false);

        const covered = await service.loadCoverage(window);
        expect(covered).toEqual(new Set(['a']));
    });

    it('answers empty results when the bridge is unavailable', async () => {
        getProgramsForChannels.mockResolvedValue(null);
        getProgramCoverage.mockResolvedValue(null);
        const window = { channels: service.channels(), fromMs: 1, toMs: 2 };
        expect((await service.loadPrograms(window)).size).toBe(0);
        expect((await service.loadCoverage(window)).size).toBe(0);
    });

    it('mirrors the active channel and dispatches playback on activate', () => {
        expect(service.activeChannelId()).toBe('a');
        service.activate('b');
        expect(dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({ channel: channels()[1], startPlayback: true })
        );
        service.activate('missing');
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('seeds the initial scope from the sidebar view', () => {
        service.applyInitialScope('favorites');
        expect(service.scopeId()).toBe('favorites');
        service.applyInitialScope('groups');
        expect(service.scopeId()).toBe('group:News');
        service.applyInitialScope('all');
        expect(service.scopeId()).toBe('all');
    });

    it('forwards programme search to the bridge', async () => {
        searchPrograms.mockResolvedValue([program('x')]);
        await expect(service.searchPrograms('news')).resolves.toHaveLength(1);
        expect(searchPrograms).toHaveBeenCalledWith('news', 20);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/playlist/m3u/feature-player/src/lib/epg-guide/m3u-epg-guide-source.service.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the adapter**

```ts
// libs/playlist/m3u/feature-player/src/lib/epg-guide/m3u-epg-guide-source.service.ts
import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { resolveChannelEpgLookupKey } from '@iptvnator/m3u-state';
import { SettingsStore } from '@iptvnator/services';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EpgGuideChannel,
    EpgGuideScope,
    EpgGuideSource,
    EpgGuideWindow,
} from '@iptvnator/ui/epg';
import { createM3uChannelPlaybackRequest } from '../video-player/m3u-channel-playback-actions';

export interface M3uEpgGuideInputs {
    /** Guide-eligible channels (host excludes radio and recognised movies). */
    channels: Signal<Channel[]>;
    favoriteIds: Signal<string[]>;
    activeChannel: Signal<Channel | null>;
}

const SCOPE_ALL = 'all';
const SCOPE_FAVORITES = 'favorites';
const GROUP_PREFIX = 'group:';
const SEARCH_LIMIT = 20;

/**
 * `EPG_GUIDE_SOURCE` for the M3U player. Channels, favorites and the active
 * channel are bound by the host; programmes come from the XMLTV bridge
 * keyed by the same lookup chain the sidebar uses (tvg-id → tvg-name → name).
 * Queries are unscoped (all imported EPG sources), like the M3U timeline.
 */
@Injectable()
export class M3uEpgGuideSourceService implements EpgGuideSource {
    private readonly store = inject(Store);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);

    private readonly inputs = signal<M3uEpgGuideInputs | null>(null);
    private readonly scope = signal(SCOPE_ALL);

    readonly scopeId = this.scope.asReadonly();

    private readonly allChannels = computed(
        () => this.inputs()?.channels() ?? []
    );

    readonly scopes = computed<EpgGuideScope[]>(() => {
        const groups: string[] = [];
        const seen = new Set<string>();
        for (const channel of this.allChannels()) {
            const title = channel.group?.title?.trim();
            if (title && !seen.has(title)) {
                seen.add(title);
                groups.push(title);
            }
        }
        return [
            { id: SCOPE_ALL, label: 'All channels', kind: 'all' },
            { id: SCOPE_FAVORITES, label: 'Favorites', kind: 'favorites' },
            ...groups.map((title) => ({
                id: `${GROUP_PREFIX}${title}`,
                label: title,
                kind: 'group' as const,
            })),
        ];
    });

    private readonly scopedChannels = computed(() => {
        const scope = this.scope();
        const channels = this.allChannels();
        if (scope === SCOPE_FAVORITES) {
            const favorites = new Set(this.inputs()?.favoriteIds() ?? []);
            return channels.filter((channel) => favorites.has(channel.id));
        }
        if (scope.startsWith(GROUP_PREFIX)) {
            const title = scope.slice(GROUP_PREFIX.length);
            return channels.filter(
                (channel) => channel.group?.title?.trim() === title
            );
        }
        return channels;
    });

    readonly channels = computed<EpgGuideChannel[]>(() => {
        const strip = this.settingsStore.stripCountryPrefix?.();
        return this.scopedChannels().map((channel, index) => ({
            id: channel.id,
            number: index + 1,
            name: applyChannelNameStrip(channel.name, strip) || channel.name,
            logoUrl: channel.tvg?.logo?.trim() || null,
            epgKey: resolveChannelEpgLookupKey(channel) || null,
        }));
    });

    readonly activeChannelId = computed(
        () => this.inputs()?.activeChannel()?.id ?? null
    );

    bind(inputs: M3uEpgGuideInputs): void {
        this.inputs.set(inputs);
    }

    /** Called by the host when the guide opens: mirror the sidebar view. */
    applyInitialScope(view: string): void {
        if (view === SCOPE_FAVORITES) {
            this.scope.set(SCOPE_FAVORITES);
            return;
        }
        const activeGroup = this.inputs()?.activeChannel()?.group?.title?.trim();
        if (view === 'groups' && activeGroup) {
            this.scope.set(`${GROUP_PREFIX}${activeGroup}`);
            return;
        }
        this.scope.set(SCOPE_ALL);
    }

    setScope(id: string): void {
        if (this.scopes().some((scope) => scope.id === id)) {
            this.scope.set(id);
        }
    }

    async loadPrograms(
        window: EpgGuideWindow
    ): Promise<Map<string, EpgProgram[]>> {
        const keyed = this.keyedChannels(window.channels);
        const result = new Map<string, EpgProgram[]>();
        if (keyed.length === 0) {
            return result;
        }
        const response = await this.epgBridge.getProgramsForChannels({
            channelIds: Array.from(new Set(keyed.map(([, key]) => key))),
            fromMs: window.fromMs,
            toMs: window.toMs,
        });
        if (!response) {
            return result;
        }
        for (const [channel, key] of keyed) {
            result.set(channel.id, response[key] ?? []);
        }
        return result;
    }

    async loadCoverage(window: EpgGuideWindow): Promise<Set<string>> {
        const keyed = this.keyedChannels(window.channels);
        const covered = new Set<string>();
        if (keyed.length === 0) {
            return covered;
        }
        const response = await this.epgBridge.getProgramCoverage({
            channelIds: Array.from(new Set(keyed.map(([, key]) => key))),
            fromMs: window.fromMs,
            toMs: window.toMs,
        });
        const keys = new Set(response ?? []);
        for (const [channel, key] of keyed) {
            if (keys.has(key)) {
                covered.add(channel.id);
            }
        }
        return covered;
    }

    activate(channelId: string): void {
        const channel = this.scopedChannels().find(
            (candidate) => candidate.id === channelId
        );
        if (channel) {
            this.store.dispatch(createM3uChannelPlaybackRequest(channel));
        }
    }

    async searchPrograms(query: string): Promise<EpgProgram[]> {
        return (await this.epgBridge.searchPrograms(query, SEARCH_LIMIT)) ?? [];
    }

    private keyedChannels(
        channels: EpgGuideChannel[]
    ): Array<[EpgGuideChannel, string]> {
        return channels
            .filter((channel) => channel.epgKey !== null)
            .map((channel) => [channel, channel.epgKey as string]);
    }
}
```

Scope labels "All channels" / "Favorites" must be translated: import
`TranslateService` and use `this.translate.instant('CHANNELS.ALL_CHANNELS')` /
`'CHANNELS.FAVORITES'` if those keys exist (`grep -n '"ALL_CHANNELS"\|"FAVORITES"' apps/web/src/assets/i18n/en.json`); otherwise add
`EPG.GUIDE.SCOPE_ALL: "All channels"` and `EPG.GUIDE.SCOPE_FAVORITES: "Favorites"` to `en.json` (and Task 11's locale pass) and use those. Provide `TranslateService` in the spec as `{ instant: (key: string) => key }` and adjust the label assertions to the keys.

- [ ] **Step 4: Run the spec**

Same command as Step 2. Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/playlist/m3u/feature-player/src/lib/epg-guide
git commit -m "feat(m3u): adapt the playlist channel list to the guide contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: Host integration — guide mode, docked player, entry points

**Files:**
- Modify: `libs/portal/shared/util/src/lib/workspace-header-context.service.ts` (optional `active`)
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/components/workspace-shell-header/workspace-shell-header.component.html:118-129` and `.scss`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.ts`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.html`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.scss`
- Modify: `libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.spec.ts`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-shell/services/workspace-shell.facade.spec.ts:880-925`
- Modify: `libs/workspace/shell/feature/src/lib/workspace-command-palette/workspace-command-palette.component.spec.ts` (rename fixture id `multi-epg` → `epg-guide`, label `Open programme guide`, icon `grid_view`)

`video-player.component.ts` is baselined (1590 lines). Add only thin glue
here; logic lives in `M3uEpgGuideSourceService` (Task 8) and the guide
components. Net growth must stay under ~80 lines.

- [ ] **Step 1: Header action "active" state**

`workspace-header-context.service.ts` — add to `WorkspaceHeaderAction`:

```ts
    /** Pressed/highlighted state for toggling actions (e.g. the guide). */
    active?: () => boolean;
```

`workspace-shell-header.component.html` — on the `.header-shortcut` button add:

```html
                    [class.is-active]="action.active?.() ?? false"
                    [attr.aria-pressed]="action.active ? action.active() : null"
```

`workspace-shell-header.component.scss` — append:

```scss
.header-shortcut.is-active {
    background: var(--app-selection-surface);
    color: var(--app-selection-color);
}
```

- [ ] **Step 2: Write the failing host specs**

In `video-player.component.spec.ts`:

1. Add stubs next to the other stubs:

```ts
@Component({
    selector: 'app-epg-guide',
    standalone: true,
    template: '<div class="stub-guide"></div>',
})
class StubEpgGuideComponent {
    readonly close = output<void>();
    readonly channelActivated = output<string>();
}

@Component({
    selector: 'app-epg-guide-now-playing',
    standalone: true,
    template: '',
})
class StubEpgGuideNowPlayingComponent {
    readonly channelName = input('');
    readonly program = input<EpgProgram | null>(null);
    readonly offsetMinutes = input(0);
    readonly collapsed = input(false);
    readonly closeRequested = output<void>();
    readonly collapsedChange = output<boolean>();
}
```

and add both to the `overrideComponent(...).set.imports` list.

2. Add `getEpgProgramsForChannels: jest.fn().mockResolvedValue({}), getEpgProgramCoverage: jest.fn().mockResolvedValue([]),` wherever the spec builds `window.electron` for the Electron branch (search for `window.electron = {`), and `EpgRuntimeBridgeService` mock is unnecessary because the adapter goes through the real bridge which reads `window.electron`. Add `selectFavorites` to the `selectSignal` switch returning `signal<string[]>([])`.

3. Update the existing header-shortcut test:

```ts
    it('registers and clears the workspace guide header shortcut', () => {
        fixture.detectChanges();
        expect(headerContext.action()).toEqual(
            expect.objectContaining({ id: 'm3u-epg-guide', icon: 'grid_view' })
        );
        fixture.destroy();
        expect(headerContext.action()).toBeNull();
    });
```

and in the PWA test rename the title to `'hides EPG controls and the guide header action in browser/PWA playback'` (assertions unchanged).

4. New cases (place after the header-shortcut test; `syncStoreState(sampleChannel)` and `player.set(...)` are the existing helpers that mount an inline player):

```ts
    it('opens the guide in place of sidebar and timeline without remounting the player', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        const playerBefore = fixture.nativeElement.querySelector('app-web-player-view');
        expect(playerBefore).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-timeline')).not.toBeNull();

        component.openGuide();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('app-epg-guide')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-guide-now-playing')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-sidebar')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-timeline')).toBeNull();
        expect(fixture.nativeElement.querySelector('.content-container').classList).toContain('is-guide');
        expect(fixture.nativeElement.querySelector('app-web-player-view')).toBe(playerBefore);
        expect(headerContext.action()?.active?.()).toBe(true);

        component.closeGuide();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('app-epg-guide')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-sidebar')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-web-player-view')).toBe(playerBefore);
    });

    it('toggles the guide with G, ignores typing, and lets the guide own other keys', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
        fixture.detectChanges();
        expect(component.guideOpen()).toBe(true);

        const pageDown = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
        document.dispatchEvent(pageDown);
        expect(pageDown.defaultPrevented).toBe(false);
        expect(storeMock.dispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: expect.stringContaining('setActiveChannel') })
        );

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', bubbles: true }));
        expect(component.guideOpen()).toBe(false);

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
        expect(component.guideOpen()).toBe(false);
        input.remove();
    });

    it('closes the guide when the live player enters fullscreen or the channel turns to radio', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        component.openGuide();
        fixture.detectChanges();

        const playerView = fixture.nativeElement.querySelector('app-web-player-view') as HTMLElement;
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => playerView,
        });
        document.dispatchEvent(new Event('fullscreenchange'));
        expect(component.guideOpen()).toBe(false);
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });

        component.openGuide();
        syncStoreState({ ...sampleChannel, radio: 'true' });
        fixture.detectChanges();
        expect(component.guideOpen()).toBe(false);
    });

    it('remembers the collapsed dock strip', () => {
        syncStoreState(sampleChannel);
        player.set(VideoPlayer.VideoJs);
        fixture.detectChanges();
        component.openGuide();
        component.setGuideDockCollapsed(true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.content-container').classList).toContain('is-guide-collapsed');
        expect(localStorage.getItem('epg-guide:dock-collapsed')).toBe('1');
        localStorage.removeItem('epg-guide:dock-collapsed');
    });
```

`storeMock.dispatch` is the existing jest mock on the store stub. If `syncStoreState` cannot express `radio: 'true'`, set `activeChannel.set({...sampleChannel, radio: 'true'})` directly (the signal the mock returns for `selectActive`).

- [ ] **Step 3: Run to verify they fail**

Run: `NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.spec.ts`
Expected: FAIL on `openGuide` / `guideOpen` not existing.

- [ ] **Step 4: Host component changes**

`video-player.component.ts`:

Imports — remove `Overlay, OverlayRef`, `ComponentPortal`, `Injector`, and from `@iptvnator/ui/epg` remove `COMPONENT_OVERLAY_REF`, `MultiEpgContainerComponent`; add:

```ts
import {
    EPG_GUIDE_SOURCE,
    EpgGuideComponent,
    EpgGuideNowPlayingComponent,
    persistEpgGuideDockCollapsed,
    restoreEpgGuideDockCollapsed,
} from '@iptvnator/ui/epg';
import { selectFavorites } from '@iptvnator/m3u-state'; // add to the existing m3u-state import list
import { M3uEpgGuideSourceService } from '../epg-guide/m3u-epg-guide-source.service';
```

Constant rename: `const M3U_MULTI_EPG_HEADER_ACTION_ID = 'm3u-multi-epg';` → `const M3U_EPG_GUIDE_HEADER_ACTION_ID = 'm3u-epg-guide';` (update both usages).

Decorator — add `EpgGuideComponent, EpgGuideNowPlayingComponent` to `imports`; add to `providers`:

```ts
        M3uEpgGuideSourceService,
        { provide: EPG_GUIDE_SOURCE, useExisting: M3uEpgGuideSourceService },
```

Fields — delete `private readonly overlay = inject(Overlay);` and `private overlayRef!: OverlayRef;`. Add after `fullscreenPanelChannels`:

```ts
    private readonly guideSource = inject(M3uEpgGuideSourceService);
    /** Guide mode: sidebar and timeline give way to the multi-channel grid. */
    readonly guideOpen = signal(false);
    readonly guideDockCollapsed = signal(restoreEpgGuideDockCollapsed());
    /** Rows the guide may show: everything that keeps the live host mounted. */
    readonly guideChannels = computed(() =>
        this.channels().filter(
            (channel) =>
                channel.radio !== 'true' && !this.opensMovieDetail(channel)
        )
    );
    readonly canOpenGuide = computed(() => {
        const channel = this.activeChannel();
        return (
            this.supportsEpg &&
            !!channel &&
            channel.radio !== 'true' &&
            !this.showMovieDetail()
        );
    });
    /** Programme shown in the docked strip (catch-up selection wins). */
    readonly guideNowPlayingProgram = computed(
        () => this.activeEpgProgramOrNull() ?? this.epgProgram() ?? null
    );
```

Constructor (add to the existing constructor body, or create one if the class has none):

```ts
        this.guideSource.bind({
            channels: this.guideChannels,
            favoriteIds: this.store.selectSignal(selectFavorites),
            activeChannel: this.activeChannel,
        });
        effect(() => {
            if (!this.canOpenGuide()) {
                untracked(() => this.closeGuide());
            }
        });
```

Methods — replace `openMultiEpgView()` entirely with:

```ts
    openGuide(): void {
        if (!this.canOpenGuide() || this.guideOpen()) {
            return;
        }
        this.guideSource.applyInitialScope(this.activeView());
        this.guideOpen.set(true);
    }

    closeGuide(): void {
        this.guideOpen.set(false);
    }

    toggleGuide(): void {
        if (this.guideOpen()) {
            this.closeGuide();
        } else {
            this.openGuide();
        }
    }

    setGuideDockCollapsed(collapsed: boolean): void {
        this.guideDockCollapsed.set(collapsed);
        persistEpgGuideDockCollapsed(collapsed);
    }

    @HostListener('document:fullscreenchange')
    onFullscreenChange(): void {
        if (this.guideOpen() && this.isLivePlayerFullscreen()) {
            this.closeGuide();
        }
    }
```

`handleKeyPress` — after the `[inert]` check and before the Cmd/Ctrl+B branch insert:

```ts
        const isGuideKey =
            event.key.toLowerCase() === 'g' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey;
        if (this.guideOpen()) {
            // The guide owns the keyboard while open; only G toggles it off.
            if (isGuideKey) {
                event.preventDefault();
                this.closeGuide();
            }
            return;
        }
        if (isGuideKey && this.canOpenGuide()) {
            event.preventDefault();
            this.openGuide();
            return;
        }
```

`registerHeaderShortcut` — replace the `setAction` payload:

```ts
        this.workspaceHeaderContext.setAction({
            id: M3U_EPG_GUIDE_HEADER_ACTION_ID,
            icon: 'grid_view',
            tooltipKey: 'TOP_MENU.OPEN_EPG_GUIDE',
            ariaLabelKey: 'TOP_MENU.OPEN_EPG_GUIDE',
            active: () => this.guideOpen(),
            palette: {
                labelKey: 'TOP_MENU.OPEN_EPG_GUIDE',
                descriptionKey:
                    'WORKSPACE.SHELL.COMMANDS.OPEN_EPG_GUIDE_DESCRIPTION',
                keywords: ['epg', 'guide', 'schedule'],
                priority: 10,
            },
            run: () => this.toggleGuide(),
        });
```

`video-player.component.html`:

- Wrap the whole `<div class="sidebar" …>…</div>` in `@if (!guideOpen()) { … }`.
- `<div class="content-container">` → `<div class="content-container" [class.is-guide]="guideOpen()" [class.is-guide-collapsed]="guideOpen() && guideDockCollapsed()">`.
- The `sidebar-restore` `@if (isSidebarCollapsed())` → `@if (isSidebarCollapsed() && !guideOpen())`.
- Inside `<div class="video-player">`, after the `@if (radio) … @else … app-web-player-view` block (still inside `.video-player`), add:

```html
                    @if (guideOpen()) {
                        <app-epg-guide-now-playing
                            class="guide-dock__info"
                            [channelName]="timelineChannelName()"
                            [program]="guideNowPlayingProgram()"
                            [offsetMinutes]="epgOffsetMinutes()"
                            [collapsed]="guideDockCollapsed()"
                            (closeRequested)="closeGuide()"
                            (collapsedChange)="setGuideDockCollapsed($event)"
                        />
                    }
```

- Directly after that `.video-player` block's closing `}` (the `@if (radio || inline)` branch), add the external-player variant of the strip:

```html
            @if (guideOpen() && !shouldShowInlinePlayer(activeChannel)) {
                <div class="video-player guide-dock--external">
                    <app-epg-guide-now-playing
                        [channelName]="timelineChannelName()"
                        [program]="guideNowPlayingProgram()"
                        [offsetMinutes]="epgOffsetMinutes()"
                        [collapsed]="true"
                        (closeRequested)="closeGuide()"
                        (collapsedChange)="setGuideDockCollapsed($event)"
                    />
                </div>
            }
```

- Replace `@if (supportsEpg && activeChannel.radio !== 'true') {` … `}` (the EPG block) with:

```html
            @if (guideOpen()) {
                <app-epg-guide
                    class="epg-guide-host"
                    (close)="closeGuide()"
                />
            } @else if (supportsEpg && activeChannel.radio !== 'true') {
                … existing `.epg` block unchanged …
            }
```

- On `<app-epg-timeline …>` add `[guideAvailable]="canOpenGuide()"` and `(openGuide)="openGuide()"`.

`video-player.component.scss` — append:

```scss
// ─── Guide mode ─────────────────────────────────────────────────────────────
// The player keeps its DOM position and is only re-flowed into a docked strip;
// no remount, so playback (and native-view Embedded MPV bounds) survive.
.content-container.is-guide {
    .video-player {
        flex: 0 0 auto;
        height: 128px;
        display: flex;
        align-items: stretch;
        gap: 18px;
        padding: 14px 18px;
        box-sizing: border-box;
        background: var(--app-widget-bg);
        border-bottom: 1px solid var(--app-separator);

        > app-web-player-view {
            flex: 0 0 auto;
            height: 100%;
            aspect-ratio: 16 / 9;
            border-radius: 9px;
            overflow: hidden;
            background: #000;
        }

        > app-epg-guide-now-playing {
            flex: 1;
            min-width: 0;
        }
    }

    .guide-dock--external {
        height: 48px;
        padding: 6px 18px;
    }

    .epg-guide-host {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    &.is-guide-collapsed .video-player {
        height: 48px;
        padding: 6px 18px;

        > app-web-player-view {
            display: none;
        }
    }
}
```

- [ ] **Step 5: Palette and facade spec renames**

`workspace-shell.facade.spec.ts:880-925`: rename the test to `'includes M3U navigation, playlist actions, and the programme guide on playlist routes'`, replace `'m3u-multi-epg'` → `'m3u-epg-guide'` (3 places), `'view_list'` → `'grid_view'`, `'TOP_MENU.OPEN_MULTI_EPG'` → `'TOP_MENU.OPEN_EPG_GUIDE'` (2), `'WORKSPACE.SHELL.COMMANDS.OPEN_MULTI_EPG_DESCRIPTION'` → `'WORKSPACE.SHELL.COMMANDS.OPEN_EPG_GUIDE_DESCRIPTION'`.

`workspace-command-palette.component.spec.ts`: replace fixture id `'multi-epg'` → `'epg-guide'` (4 places), label `'Open Multi-EPG'` → `'Open programme guide'`, icon `'view_list'` → `'grid_view'`.

- [ ] **Step 6: Run host, shell and lint**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules node node_modules/jest/bin/jest.js --config jest.web-esm.workspace.ts --runTestsByPath libs/playlist/m3u/feature-player/src/lib/video-player/video-player.component.spec.ts
pnpm nx test workspace-shell-feature
pnpm nx lint playlist-m3u-feature-player workspace-shell-feature portal-shared-util
pnpm run typecheck:ci
```
(`pnpm nx show projects | grep shell` gives the exact shell project name if it differs.) Expected: all PASS; lint clean.

- [ ] **Step 7: Commit**

```bash
git add libs/portal/shared/util/src/lib/workspace-header-context.service.ts libs/workspace/shell libs/playlist/m3u/feature-player
git commit -m "feat(m3u): open the programme guide in place with a docked player

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 10: Remove the old multi-EPG overlay and its plumbing

**Files:**
- Delete: `libs/ui/epg/src/lib/multi-epg/` (3 files)
- Modify: `libs/ui/epg/src/index.ts` (drop the two `multi-epg` exports)
- Modify: `apps/electron-backend/src/app/events/epg-query.service.ts:404-451` (delete `getChannelsByRange`)
- Modify: `apps/electron-backend/src/app/events/epg-query.service.spec.ts` (delete any `getChannelsByRange` case; `grep -n getChannelsByRange`)
- Modify: `apps/electron-backend-e2e/src/epg.e2e.ts:719-724`
- Modify: `apps/web/src/styles.scss:106-108`
- Modify: `libs/ui/components/src/lib/window-controls/window-controls.component.ts:17-24,91-95`
- Modify: `libs/ui/epg/src/lib/epg-item-description/epg-item-description.component.ts:81-83`
- Modify: `tools/eslint/max-lines-baseline.mjs` (regenerated)

- [ ] **Step 1: Delete the component and its exports**

```bash
git rm -r libs/ui/epg/src/lib/multi-epg
```

Remove from `libs/ui/epg/src/index.ts`:
```ts
export * from './lib/multi-epg/multi-epg-container.component';
export * from './lib/multi-epg/overlay-ref.token';
```

- [ ] **Step 2: Delete the backend range query**

In `epg-query.service.ts` delete the whole `getChannelsByRange` method (the block starting `async getChannelsByRange(` through its closing brace, ~48 lines). Delete its spec cases if any exist.

- [ ] **Step 3: E2E helper**

In `apps/electron-backend-e2e/src/epg.e2e.ts` replace `getEpgChannelCount`:

```ts
async function getEpgChannelCount(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const result = await window.electron?.getEpgChannels?.();
        return Array.isArray(result?.channels) ? result.channels.length : 0;
    });
}
```

- [ ] **Step 4: Comments and styles that described the overlay**

`apps/web/src/styles.scss`: delete the `body.frameless-platform #epg-navigation { … }` rule (lines 106-108).

`window-controls.component.ts:17-24`: replace "above full-window content such as the multi-EPG overlay and dialog backdrops" with "above full-window content such as dialog backdrops"; line 94: replace "(dialogs, multi-EPG)" with "(dialogs, menus)".

`epg-item-description.component.ts:81-83`: replace "the multi-EPG grid and its search" with "the programme guide grid and its search".

- [ ] **Step 5: Regenerate the max-lines baseline**

```bash
node tools/eslint/generate-max-lines-baseline.mjs
git diff --stat tools/eslint/max-lines-baseline.mjs
```
Expected: exactly one line removed (`libs/ui/epg/src/lib/multi-epg/multi-epg-container.component.ts`); no additions. If the generator lists any new file, split that file instead of committing the baseline.

- [ ] **Step 6: Verify nothing references the old names**

```bash
grep -rn 'MultiEpg\|multi-epg\|COMPONENT_OVERLAY_REF\|getChannelsByRange\|EPG_GET_CHANNELS_BY_RANGE\|supportsChannelBrowser\|OPEN_MULTI_EPG\|epg-navigation' apps libs tools --include='*.ts' --include='*.html' --include='*.scss' --include='*.mjs' --include='*.json' | grep -v node_modules
```
Expected: only i18n JSON hits for `OPEN_MULTI_EPG` in the non-English locales (removed in Task 11) and nothing else.

- [ ] **Step 7: Typecheck, lint, tests**

```bash
pnpm run typecheck:ci
pnpm nx lint ui-epg electron-backend web
pnpm nx test ui-epg
pnpm nx test electron-backend --testPathPatterns='epg'
```
Expected: clean / PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(epg): remove the multi-EPG overlay and the channel-range IPC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: Translations for all 19 locales

**Files:**
- Modify: `apps/web/src/assets/i18n/*.json` (18 non-English locales)

- [ ] **Step 1: Add the new keys to every locale**

Invoke the repository skill `i18n-fill` (`Skill: i18n-fill`) and ask it to sync the gap for the keys added in Task 6 (and Task 8's scope labels if you added `EPG.GUIDE.SCOPE_ALL`/`SCOPE_FAVORITES`): `EPG.GUIDE.*`, `EPG.TIMELINE.GUIDE`, `EPG.TIMELINE.OPEN_GUIDE`, `TOP_MENU.OPEN_EPG_GUIDE`, `WORKSPACE.SHELL.COMMANDS.OPEN_EPG_GUIDE_DESCRIPTION`. The merger only ADDS keys, so existing ones are untouched.

- [ ] **Step 2: Remove the two retired keys from every locale**

Write the removal as a one-off script in the scratchpad and run it:

```js
// scratchpad/remove-old-multi-epg-keys.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'apps/web/src/assets/i18n';
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const path = `${dir}/${file}`;
    const json = JSON.parse(readFileSync(path, 'utf8'));
    delete json.TOP_MENU?.OPEN_MULTI_EPG;
    delete json.WORKSPACE?.SHELL?.COMMANDS?.OPEN_MULTI_EPG_DESCRIPTION;
    writeFileSync(path, JSON.stringify(json, null, 4) + '\n');
}
```

Run: `node <scratchpad>/remove-old-multi-epg-keys.mjs` and then `git diff --stat apps/web/src/assets/i18n` — every file should show only the intended key changes (compare the JSON indentation with `git diff` on `en.json`; if the repo uses a different indent, match it before committing).

- [ ] **Step 3: Verify**

```bash
grep -rn 'OPEN_MULTI_EPG' apps/web/src/assets/i18n | wc -l   # expected: 0
grep -c '"GUIDE": {' apps/web/src/assets/i18n/*.json           # expected: 1 per file (19 lines)
pnpm nx test web --testPathPatterns=i18n 2>/dev/null || true    # if an i18n consistency spec exists it must pass
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/assets/i18n
git commit -m "i18n(epg): translate the programme guide

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 12: Electron E2E for the guide

**Files:**
- Create: `apps/electron-backend-e2e/src/epg-guide.e2e.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/electron-backend-e2e/src/epg-guide.e2e.ts
import {
    buildM3uContent,
    channelItemByTitle,
    closeElectronApp,
    createMutableTextServer,
    expect,
    importM3uPlaylistFromUrl,
    launchElectronApp,
    openWorkspaceSection,
    test,
} from './electron-test-fixtures';

function formatXmltvDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds()),
    ].join('');
}

function xmltvWithCurrentProgramme(
    channelId: string,
    channelName: string,
    title: string
): string {
    const start = new Date(Date.now() - 15 * 60 * 1000);
    const stop = new Date(Date.now() + 45 * 60 * 1000);
    return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="${channelId}"><display-name>${channelName}</display-name></channel>
  <programme start="${formatXmltvDate(start)} +0000" stop="${formatXmltvDate(stop)} +0000" channel="${channelId}">
    <title>${title}</title>
    <desc>Guide E2E programme.</desc>
  </programme>
</tv>
`;
}

test('@epg @electron opens the programme guide with the playlist channels, switches channels and keeps the player mounted', async ({
    dataDir,
}) => {
    test.setTimeout(120000);
    const epgServer = await createMutableTextServer(
        xmltvWithCurrentProgramme('guide-news', 'Guide News', 'Guide Bulletin Now'),
        { contentType: 'application/xml; charset=utf-8', resourcePath: '/guide.xml' }
    );
    const playlistServer = await createMutableTextServer(
        buildM3uContent([
            { name: 'Guide News', tvgId: 'guide-news', url: 'https://example.com/live/guide-news.m3u8' },
            { name: 'Guide Silent', tvgId: 'guide-silent', url: 'https://example.com/live/guide-silent.m3u8' },
        ]).replace('#EXTM3U', `#EXTM3U x-tvg-url="${epgServer.resourceUrl}"`),
        { contentType: 'application/x-mpegurl; charset=utf-8', resourcePath: '/guide-playlist.m3u' }
    );
    const app = await launchElectronApp(dataDir);

    try {
        await app.electronApp.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
        });
        // The demo stream URLs are unreachable; the player still mounts.
        await app.mainWindow.route('https://example.com/**', (route) => route.abort());

        await importM3uPlaylistFromUrl(app.mainWindow, playlistServer.resourceUrl);
        await expect(
            app.mainWindow.locator('.epg-progress-panel .import-item.status-complete')
        ).toHaveCount(1, { timeout: 30000 });

        await openWorkspaceSection(app.mainWindow, 'All channels');
        const newsRow = channelItemByTitle(app.mainWindow, 'Guide News');
        await expect(newsRow).toBeVisible();
        await newsRow.click();

        const timeline = app.mainWindow.locator('app-epg-timeline');
        await expect(timeline).toBeVisible({ timeout: 20000 });
        await app.mainWindow.evaluate(() =>
            document.querySelector('app-web-player-view')?.setAttribute('data-e2e-guide-marker', 'kept')
        );

        // Entry point: the Guide button in the timeline toolbar.
        await timeline.locator('.epg-timeline__guide').click();
        const guide = app.mainWindow.locator('app-epg-guide');
        await expect(guide).toBeVisible();
        await expect(app.mainWindow.locator('app-sidebar')).toHaveCount(0);
        await expect(timeline).toHaveCount(0);

        // Rows are the playlist's channels, in order, with the playing row marked.
        const rows = guide.locator('app-epg-guide-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0).locator('.epg-guide-row__name b')).toHaveText('Guide News');
        await expect(rows.nth(1).locator('.epg-guide-row__name b')).toHaveText('Guide Silent');
        await expect(rows.nth(0)).toHaveClass(/is-active/);
        await expect(rows.nth(0).locator('.epg-guide-row__block.is-now')).toContainText('Guide Bulletin Now', { timeout: 20000 });
        await expect(rows.nth(1).locator('.epg-guide-row__empty')).toBeVisible({ timeout: 20000 });

        // "Only with EPG" hides the silent channel once coverage is known.
        const toggle = guide.locator('.guide-toolbar__toggle input');
        await expect(toggle).toBeEnabled({ timeout: 20000 });
        await guide.locator('.guide-toolbar__toggle').click();
        await expect(rows).toHaveCount(1);
        await guide.locator('.guide-toolbar__toggle').click();
        await expect(rows).toHaveCount(2);

        // Clicking a channel switches playback without closing the guide.
        await rows.nth(1).locator('.epg-guide-row__channel').click();
        await expect(rows.nth(1)).toHaveClass(/is-active/);
        await expect(rows.nth(0)).not.toHaveClass(/is-active/);
        await expect(guide).toBeVisible();
        await expect(app.mainWindow.locator('app-epg-guide-now-playing')).toContainText('Guide Silent');

        // The player element survived both the mode switch and the channel switch.
        await expect(
            app.mainWindow.locator('app-web-player-view[data-e2e-guide-marker="kept"]')
        ).toHaveCount(1);

        // Escape closes the guide and restores the sidebar and timeline.
        await app.mainWindow.keyboard.press('Escape');
        await expect(guide).toHaveCount(0);
        await expect(app.mainWindow.locator('app-sidebar')).toBeVisible();
        await expect(app.mainWindow.locator('app-epg-timeline')).toBeVisible();
        await expect(
            app.mainWindow.locator('app-web-player-view[data-e2e-guide-marker="kept"]')
        ).toHaveCount(1);

        // G reopens it; the header shortcut is highlighted while open.
        await app.mainWindow.keyboard.press('g');
        await expect(guide).toBeVisible();
        await expect(app.mainWindow.locator('.header-shortcut.is-active')).toHaveCount(1);
    } finally {
        await closeElectronApp(app);
        await playlistServer.close();
        await epgServer.close();
    }
});
```

Note: a channel switch through `ChannelActions.setActiveChannel` with an
inline player keeps `app-web-player-view` mounted (the marker assertion
proves it); if the marker disappears, the host template moved the player
inside an `@if` that toggles — fix the template, not the test.

- [ ] **Step 2: Run the test**

Run: `pnpm nx run electron-backend-e2e:e2e-ci--src/epg-guide.e2e.ts`
(If the atomized target is not generated for the new file, run `pnpm nx reset` first, then retry; the target list comes from the file system.)
Expected: 1 passed. Ports 3210/3211/4200 are shared across worktrees — make sure no other E2E run is active.

- [ ] **Step 3: Commit**

```bash
git add apps/electron-backend-e2e/src/epg-guide.e2e.ts
git commit -m "test(e2e): cover the programme guide flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 13: Docs, CLAUDE.md, spec touch-ups and release note

**Files:**
- Modify: `docs/architecture/m3u-playlist-module.md:700-712,1060-1075`
- Modify: `docs/architecture/workspace-shell.md:265-272,400-410`
- Modify: `docs/architecture/pwa-self-hosted.md:114-116`
- Modify: `CLAUDE.md` (`ui/epg` bullet in Monorepo Structure; the EPG display-offset bullet under "EPG (Electronic Program Guide)")
- Modify: `docs/superpowers/specs/2026-09-06-epg-guide-m3u-design.md` (two deviations)
- Create: `.changes/epg-programme-guide.md`

- [ ] **Step 1: m3u-playlist-module.md**

Replace the bullet `- Multi-EPG modal view` (line ~1071) with `- Programme guide (multi-channel grid) in guide mode — see "Programme guide" below`, and add a section after "Archive / Catch-Up Playback":

```markdown
### Programme guide

`app-epg-guide` (`libs/ui/epg/src/lib/epg-guide/`) is a host-agnostic
multi-channel grid. It reads everything through the `EPG_GUIDE_SOURCE`
injection token (`epg-guide-source.ts`): the scope-resolved channel list
(`EpgGuideChannel { id, number, name, logoUrl, epgKey }`), the available scopes
(all / group / favorites), `loadPrograms(window)` and `loadCoverage(window)`
for a provider-clock time window, the active channel and `activate(id)`.
The M3U adapter is `M3uEpgGuideSourceService`
(`libs/playlist/m3u/feature-player/src/lib/epg-guide/`): channels come from
NgRx, `epgKey` uses the `tvg.id → tvg.name → name` chain, and the two bridge
reads `EPG_GET_PROGRAMS_FOR_CHANNELS` / `EPG_GET_PROGRAM_COVERAGE` resolve keys
in the main process (manual mappings first, then the metadata lookup shared
with the sidebar) and return programmes keyed by the requested key. Queries
are unscoped, like the timeline.

Guide mode is host layout, not an overlay: `VideoPlayerComponent.guideOpen`
hides the sidebar and the timeline, renders the guide, and CSS reflows the
untouched `app-web-player-view` into a 128 px docked strip
(`.content-container.is-guide`) beside `app-epg-guide-now-playing`; the strip
collapses to one line (`epg-guide:dock-collapsed`). Nothing remounts, so
playback and native-view Embedded MPV bounds survive. Entry points: the
workspace header action (`m3u-epg-guide`), the command palette, the Guide
button in the timeline toolbar (`EpgTimelineComponent.openGuide`) and the `G`
key on the player page. Player fullscreen, radio, recognised movies and the
PWA close or withhold it. Inside the guide: single click on a row or an
"on now" card switches the channel and keeps the guide open, double-click or
Enter switches and closes, other cards open the programme dialog; ↑/↓ ←/→
navigate, I details, N now, PgUp/PgDn day, Esc close. Density
(`epg-guide:density`, comfortable 60 px / compact 44 px), zoom
(`epg-guide:zoom`, 120–480 px per hour) and the "Only with EPG" toggle
(`epg-guide:only-with-epg`) persist in localStorage; coverage is loaded for the
whole scope so the toggle never hides rows as they scroll in. The guide reads
the EPG display offset itself: the day axis is display time, the request
window is converted with `epgProviderClockMs`.
```

Line ~706: "the programme dialog and the multi-EPG overlay are opened imperatively" → "the programme dialog and the programme guide are opened imperatively".

- [ ] **Step 2: workspace-shell.md and pwa-self-hosted.md**

`workspace-shell.md:268`: "above full-window content such as the multi-EPG cdk overlay and Material dialog backdrops" → "above full-window content such as Material dialog backdrops".
`workspace-shell.md:405`: "top-aligned drag regions (`.workspace-header`, multi-EPG `#epg-navigation`)" → "the top-aligned drag region (`.workspace-header`)".
`pwa-self-hosted.md:115`: "multi-EPG shortcuts" → "programme-guide entry points".

- [ ] **Step 3: CLAUDE.md**

- Monorepo Structure: `- **ui/epg** - EPG UI (timeline ribbon, multi-EPG, progress panel, program dialogs)` → `- **ui/epg** - EPG UI (timeline ribbon, programme guide grid via \`EPG_GUIDE_SOURCE\`, progress panel, program dialogs)`.
- EPG section bullet on the display offset: "(the programme dialog and multi-EPG overlay read the store themselves)" → "(the programme dialog and the programme guide read the store themselves)".
- Add to the EPG section a bullet:
  `- Programme guide (Electron, M3U): \`app-epg-guide\` in \`libs/ui/epg\` fed by the host-provided \`EPG_GUIDE_SOURCE\`; the M3U host switches into guide mode (docked player strip, no sidebar/timeline, no remount) from the header action, the palette, the timeline's Guide button or \`G\`. Data: \`EPG_GET_PROGRAMS_FOR_CHANNELS\` / \`EPG_GET_PROGRAM_COVERAGE\` (keys resolved in main; manual mappings honoured). Contract: \`docs/architecture/m3u-playlist-module.md\` ("Programme guide").`
- Also grep `CLAUDE.md` for `getEpgChannelsByRange`/`multi-EPG` and fix every remaining mention.

- [ ] **Step 4: Spec deviations**

In `docs/superpowers/specs/2026-09-06-epg-guide-m3u-design.md`, "M3U Host" bullet 3: replace "`loadPrograms`/`loadCoverage` call the new bridge methods with the playlist's `sourceUrls`, as `EpgService.getCurrentProgramsForChannels` does, so playlist-scoped EPG wins." with "`loadPrograms`/`loadCoverage` call the new bridge methods unscoped (every imported EPG source), exactly like the timeline's `getChannelPrograms`; `sourceUrls` stays in the IPC contract for portal hosts." and "`searchPrograms` uses `EPG_SEARCH_PROGRAMS` and filters results to the scope's resolved channel ids." with "`searchPrograms` uses `EPG_SEARCH_PROGRAMS` unfiltered (result click opens the programme dialog, as the previous overlay did)."

- [ ] **Step 5: Release note**

```markdown
<!-- .changes/epg-programme-guide.md -->
---
type: feature
area: epg
issues: [171]
highlight: Programme guide, rebuilt
---

The programme guide now shows your playlist's own channels in their order, with
the current group or favorites one click away. Clicking a channel switches
playback while the player stays on screen above the grid; double-click plays
and closes. Open it from the new Guide button under the player, the header, the
command palette or the G key. Hide channels without EPG, pick comfortable or
compact rows, and navigate with the keyboard.
```

Run: `pnpm run release:notes:validate` — expected: OK.

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md .changes/epg-programme-guide.md
git commit -m "docs(epg): document the programme guide and its release note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 14: Final validation

- [ ] **Step 1: Unit suites and lint for every touched project**

```bash
pnpm run typecheck:ci
pnpm nx run-many -t lint -p ui-epg playlist-m3u-feature-player epg-data-access services electron-backend web workspace-shell-feature portal-shared-util
pnpm nx run-many -t test -p ui-epg playlist-m3u-feature-player epg-data-access services workspace-shell-feature
pnpm nx test electron-backend
pnpm run release:notes:validate
```
Expected: all green. `git status` must show no untracked files.

- [ ] **Step 2: E2E**

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/epg-guide.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/epg.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/epg-timeline-interaction.e2e.ts
```
Expected: all passed.

- [ ] **Step 3: Manual CDP check (Embedded MPV native-view bounds)**

```bash
pnpm run serve:backend
```
In the app: Settings → Playback → Embedded MPV (native-view); open an M3U playlist with a working stream; press `G`; confirm the video is confined to the 16:9 thumb in the docked strip, that "Collapse player" hides it and audio continues, that resizing the window keeps the thumb aligned, and that Esc restores the full player. Capture `agent-browser --cdp 9222 screenshot` of the open guide for the PR.

- [ ] **Step 4: Open the PR**

Push the branch and open a PR against `master` titled `feat(epg): rebuild the programme guide for M3U playlists`, body: what changed (issue #171 items, guide mode, new IPCs, removals), test evidence (commands above), screenshots, and the follow-ups: portal hosts (sub-project 2), `multi-epg-view.webp` recapture at release, M3U catch-up wiring. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review notes

- Spec coverage: contract (T3), guide component incl. toolbar/row/now-playing/keyboard/density/zoom/persistence (T4–T6), timeline button (T7), M3U adapter + scopes (T8), host guide mode + four entry points + close rules (T9), backend IPCs + capability + removals (T1, T2, T10), i18n (T6, T11), E2E (T12), docs + release note (T13), validation (T14).
- Deviations from the spec are recorded in T13 Step 4 (unscoped queries; unfiltered search).
- Type consistency: `EpgGuideChannel/Scope/Window/Source` (T3) are used unchanged in T4, T6, T8; `EpgGuideRowStatus` comes from T4 and is consumed by T6's row; `TimelineRenderBlock` is the existing timeline type reused for guide blocks; `ElectronBridgeEpgGuideWindow` (T2) is the wire shape for both IPCs and matches `EpgGuideWindowRequest` (T1) field-for-field.
