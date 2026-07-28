import { isDeepStrictEqual } from 'node:util';

import {
    XTREAM_SCENARIO_ID,
    type XtreamPerformanceManifest,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { parseXtreamManifest } from './xtream-control-state-schema';

interface XtreamCatalogPartition {
    readonly count: number;
    readonly distinctXtreamIdCount: number;
    readonly invalidNameCount: number;
    readonly maxXtreamId: number | null;
    readonly minXtreamId: number | null;
}

interface XtreamContentPartition {
    readonly count: number;
    readonly distinctXtreamIdCount: number;
    readonly invalidCategoryCardinalityCount: number;
    readonly invalidTitleCount: number;
    readonly maxXtreamId: number | null;
    readonly minXtreamId: number | null;
}

export interface XtreamCatalogDatabaseSnapshot {
    readonly captureStoppedEpochMs: number;
    readonly categories: {
        readonly live: XtreamCatalogPartition;
        readonly movies: XtreamCatalogPartition;
        readonly series: XtreamCatalogPartition;
    };
    readonly categoryCount: number;
    readonly content: {
        readonly live: XtreamContentPartition;
        readonly movie: XtreamContentPartition;
        readonly series: XtreamContentPartition;
    };
    readonly contentCount: number;
    readonly databaseReadStartedEpochMs: number;
    readonly importStatuses: {
        readonly live: string | null;
        readonly movie: string | null;
        readonly series: string | null;
    };
    readonly matchingPlaylistCount: number;
    readonly matchingPlaylistType: string | null;
    readonly playlistCount: number;
}

export interface XtreamCatalogVerification {
    readonly databaseStateValid: true;
    readonly fixtureIdentityValid: true;
    readonly providerCategoryCount: number;
    readonly providerItemCount: number;
    readonly verifiedAfterCapture: true;
}

export function assertXtreamCatalogDatabaseSnapshot(
    snapshot: unknown,
    manifest: XtreamPerformanceManifest,
    scenarioId: XtreamScenarioId
): asserts snapshot is XtreamCatalogDatabaseSnapshot {
    try {
        const canonicalManifest = parseXtreamManifest(manifest);
        assertCatalogSnapshot(snapshot, canonicalManifest, scenarioId);
    } catch {
        throw new Error('invalid Xtream database catalog state');
    }
}

export function createXtreamCatalogVerification(
    snapshot: unknown,
    manifest: XtreamPerformanceManifest,
    scenarioId: XtreamScenarioId
): XtreamCatalogVerification {
    try {
        const canonicalManifest = parseXtreamManifest(manifest);
        assertCatalogSnapshot(snapshot, canonicalManifest, scenarioId);
        return Object.freeze({
            databaseStateValid: true,
            fixtureIdentityValid: true,
            providerCategoryCount: canonicalManifest.counts.categories.total,
            providerItemCount: canonicalManifest.counts.items.total,
            verifiedAfterCapture: true,
        });
    } catch {
        throw new Error('invalid Xtream database catalog state');
    }
}

function assertCatalogSnapshot(
    snapshot: unknown,
    manifest: XtreamPerformanceManifest,
    scenarioId: XtreamScenarioId
): void {
    const expected = expectedSnapshot(manifest, scenarioId);
    const candidate = snapshotTopLevel(snapshot);
    if (
        !isSnapshotTimingValid(candidate) ||
        !isDeepStrictEqual(withoutSnapshotTiming(candidate), expected)
    ) {
        invalid();
    }
}

function expectedSnapshot(
    manifest: XtreamPerformanceManifest,
    scenarioId: XtreamScenarioId
): XtreamCatalogDatabaseSnapshot {
    if (!Object.values(XTREAM_SCENARIO_ID).includes(scenarioId)) {
        invalid();
    }
    const empty = isEmptyScenario(scenarioId);
    const deleted = scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE;
    const cancelled = scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT;
    const expected = {
        captureStoppedEpochMs: 1,
        categories: {
            live: categoryPartition(
                empty ? 0 : manifest.counts.categories.live,
                91_101
            ),
            movies: categoryPartition(
                empty ? 0 : manifest.counts.categories.vod,
                92_101
            ),
            series: categoryPartition(
                empty ? 0 : manifest.counts.categories.series,
                93_101
            ),
        },
        categoryCount: empty ? 0 : manifest.counts.categories.total,
        content: {
            live: contentPartition(
                empty ? 0 : manifest.counts.items.live,
                1_000_000
            ),
            movie: contentPartition(
                empty ? 0 : manifest.counts.items.vod,
                2_000_000
            ),
            series: contentPartition(
                empty ? 0 : manifest.counts.items.series,
                3_000_000
            ),
        },
        contentCount: empty ? 0 : manifest.counts.items.total,
        databaseReadStartedEpochMs: 1,
        importStatuses: {
            live: cancelled ? 'failed' : 'completed',
            movie: cancelled ? 'failed' : 'completed',
            series: cancelled ? 'failed' : 'completed',
        },
        matchingPlaylistCount: deleted ? 0 : 1,
        matchingPlaylistType: deleted ? null : 'xtream',
        playlistCount: deleted ? 0 : 1,
    } satisfies XtreamCatalogDatabaseSnapshot;
    return {
        ...expected,
        captureStoppedEpochMs: Number.NaN,
        databaseReadStartedEpochMs: Number.NaN,
    };
}

function snapshotTopLevel(value: unknown): XtreamCatalogDatabaseSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid();
    }
    return { ...value } as XtreamCatalogDatabaseSnapshot;
}

function isSnapshotTimingValid(
    snapshot: XtreamCatalogDatabaseSnapshot
): boolean {
    if (
        !isPositiveFinite(snapshot.captureStoppedEpochMs) ||
        !isPositiveFinite(snapshot.databaseReadStartedEpochMs) ||
        snapshot.databaseReadStartedEpochMs < snapshot.captureStoppedEpochMs
    ) {
        return false;
    }
    return true;
}

function withoutSnapshotTiming(
    snapshot: XtreamCatalogDatabaseSnapshot
): XtreamCatalogDatabaseSnapshot {
    return {
        ...snapshot,
        captureStoppedEpochMs: Number.NaN,
        databaseReadStartedEpochMs: Number.NaN,
    };
}

function isEmptyScenario(scenarioId: XtreamScenarioId): boolean {
    return (
        scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT ||
        scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE
    );
}

function categoryPartition(
    count: number,
    firstXtreamId: number
): XtreamCatalogPartition {
    return {
        count,
        distinctXtreamIdCount: count,
        invalidNameCount: 0,
        maxXtreamId: count === 0 ? null : firstXtreamId + count - 1,
        minXtreamId: count === 0 ? null : firstXtreamId,
    };
}

function contentPartition(
    count: number,
    firstXtreamId: number
): XtreamContentPartition {
    return {
        count,
        distinctXtreamIdCount: count,
        invalidCategoryCardinalityCount: 0,
        invalidTitleCount: 0,
        maxXtreamId: count === 0 ? null : firstXtreamId + count - 1,
        minXtreamId: count === 0 ? null : firstXtreamId,
    };
}

function isPositiveFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function invalid(): never {
    throw new Error('invalid');
}
