import {
    parseXtreamHistoryRecovery,
    xtreamHistoryRecoveryKey,
    type XtreamBackupRecentlyViewedItem,
    type XtreamBackupHiddenCategory,
    XTREAM_CONTENT_TYPES,
    type XtreamPendingRestoreState,
    type XtreamContentType,
} from '@iptvnator/shared/interfaces';
import type { DatabaseService } from './database-electron.service';
import type {
    XtreamDeferredCatalogRestoreService,
    DeferredCatalogSnapshot,
} from './xtream-deferred-catalog-restore.service';
import type { PlaybackPositionService } from './playback-position.service';
import { readExplicitCatalogVisibility } from './xtream-explicit-category-visibility';

export async function readCatalogHistoryRecovery(
    db: Pick<DatabaseService, 'readAppState'>,
    playlistId: string
) {
    const row = await db.readAppState(xtreamHistoryRecoveryKey(playlistId));
    if (!row) throw new Error('Could not read catalog history recovery.');
    return row.value ? parseXtreamHistoryRecovery(row.value) : null;
}

/** The worker merges live history inside the registration transaction. */
export async function beginCatalogHistoryRecovery(
    db: Pick<DatabaseService, 'setAppState'>,
    playlistId: string,
    contentTypes: readonly XtreamContentType[],
    recentlyViewed: XtreamBackupRecentlyViewedItem[]
): Promise<void> {
    if (
        !(await db.setAppState(
            xtreamHistoryRecoveryKey(playlistId),
            JSON.stringify({
                version: 1,
                contentTypes,
                recentlyViewed,
            })
        ))
    )
        throw new Error('Could not retain catalog history recovery.');
}

export async function clearCatalogHistoryRecovery(
    db: Pick<DatabaseService, 'setAppState'>,
    playlistId: string
): Promise<void> {
    if (!(await db.setAppState(xtreamHistoryRecoveryKey(playlistId), '')))
        throw new Error('Could not finish catalog history recovery.');
}

/** A replay can restore retained rows even when their unfinished catalog is disabled. */
export async function completeCatalogHistoryRecovery(
    db: Pick<
        DatabaseService,
        | 'getRecentItemsOrThrow'
        | 'readAppState'
        | 'setAppState'
        | 'getAllXtreamCategories'
        | 'getXtreamImportStatus'
    >,
    deferred: XtreamDeferredCatalogRestoreService,
    playlistId: string,
    snapshot: DeferredCatalogSnapshot,
    available: readonly XtreamContentType[],
    acknowledge?: () => Promise<void>
): Promise<void> {
    // Native replay records resolved identities atomically. Its proof survives
    // a remove/rewatch between these reads, even if the later watch erased its
    // tombstone. Missing catalog rows stay outside that proof for later retry.
    const current = await db.getRecentItemsOrThrow(playlistId);
    const journal = await readCatalogHistoryRecovery(db, playlistId);
    if (!journal) throw new Error('Catalog history recovery is unavailable.');
    const visibility = await readCatalogRecoveryVisibility(db, playlistId);
    deferred.complete(
        playlistId,
        snapshot,
        available,
        {
            identities: [
                ...current.map((row) => ({
                    contentType: row.type as XtreamContentType,
                    xtreamId: row.xtream_id,
                })),
                ...(journal.removed ?? []),
                ...(journal.resolved ?? []),
            ],
            afterClearHistory: journal.cleared
                ? journal.recentlyViewed
                : undefined,
        },
        visibility.currentCategories
    );
    // This native acknowledgment flushes the resolved DOM archive first.
    if (acknowledge) await acknowledge();
    else await clearCatalogHistoryRecovery(db, playlistId);
}

export function explicitCatalogHistoryForReplay(
    snapshot: DeferredCatalogSnapshot,
    incoming: XtreamBackupRecentlyViewedItem[]
): XtreamBackupRecentlyViewedItem[] {
    return Array.from(
        new Map(
            [...snapshot.state.recentlyViewed, ...incoming].map((row) => [
                `${row.contentType}:${row.xtreamId}`,
                row,
            ])
        ).values()
    );
}

/** Explicit archives replace history; native replay proves which copies now belong to SQLite. */
export async function completeExplicitCatalogHistoryRestore(
    db: Pick<DatabaseService, 'setAppState'>,
    deferred: XtreamDeferredCatalogRestoreService,
    playlistId: string,
    snapshot: DeferredCatalogSnapshot,
    available: readonly XtreamContentType[],
    result: unknown,
    appliedCategories: XtreamBackupHiddenCategory[] = []
): Promise<void> {
    const proof = result as {
        success?: unknown;
        resolvedHistory?: unknown;
    } | null;
    if (
        proof?.success !== true ||
        !Array.isArray(proof.resolvedHistory) ||
        proof.resolvedHistory.some(
            (row) =>
                !row ||
                !XTREAM_CONTENT_TYPES.includes(row.contentType) ||
                typeof row.xtreamId !== 'number' ||
                !Number.isFinite(row.xtreamId)
        )
    )
        throw new Error('Native history restoration proof is unavailable.');
    const current = deferred.getSnapshot(playlistId);
    if (current.key !== snapshot.key || current.raw !== snapshot.raw) return;
    deferred.complete(
        playlistId,
        snapshot,
        available,
        {
            identities: proof.resolvedHistory,
        },
        appliedCategories
    );
    // Flush consumed DOM copies before accepting explicit restoration, including
    // archives without a native journal. A newer archive keeps its own state.
    await clearCatalogHistoryRecovery(db, playlistId);
}

/** Upgrade older pending scans before bootstrap replaces their failed catalogs. */
export async function prepareLegacyCatalogHistoryRecovery(
    db: Pick<
        DatabaseService,
        'readAppState' | 'setAppState' | 'getXtreamImportStatus'
    >,
    deferred: XtreamDeferredCatalogRestoreService,
    playlistId: string,
    state: XtreamPendingRestoreState
) {
    if (!state.preservePlaybackPositions || state.catalogSnapshot)
        return undefined;
    const snapshot = deferred.getSnapshot(playlistId);
    const owned =
        snapshot.generation === null || snapshot.generation === 'legacy';
    if (!(await readCatalogHistoryRecovery(db, playlistId))) {
        const missing = new Set(
            (
                await Promise.all(
                    XTREAM_CONTENT_TYPES.map(async (type) =>
                        (await db.getXtreamImportStatus(playlistId, type)) !==
                        'completed'
                            ? type
                            : null
                    )
                )
            ).filter((type): type is XtreamContentType => type !== null)
        );
        // Existing completed catalogs own their current rows/removals. Only the
        // deleted or unfinished catalogs need the older parked identities.
        const archived = Array.from(
            new Map(
                [
                    ...(owned ? snapshot.state.recentlyViewed : []),
                    ...state.recentlyViewed,
                ]
                    .filter((row) => missing.has(row.contentType))
                    .map((row) => [`${row.contentType}:${row.xtreamId}`, row])
            ).values()
        );
        await beginCatalogHistoryRecovery(
            db,
            playlistId,
            XTREAM_CONTENT_TYPES,
            archived
        );
    }
    return owned ? snapshot : undefined;
}

/** Completed categories own visibility; partial rows retain parked hidden choices. */
export async function readCatalogRecoveryVisibility(
    db: Pick<
        DatabaseService,
        'getAllXtreamCategories' | 'getXtreamImportStatus' | 'readAppState'
    >,
    playlistId: string,
    fallback: XtreamBackupHiddenCategory[] = []
) {
    const groups = await Promise.all(
        XTREAM_CONTENT_TYPES.map(async (type) => {
            const categoryType: XtreamBackupHiddenCategory['categoryType'] =
                type === 'movie' ? 'movies' : type;
            const [categories, status] = await Promise.all([
                db.getAllXtreamCategories(playlistId, categoryType),
                db.getXtreamImportStatus(playlistId, type),
            ]);
            return categories.map((row) => ({
                categoryType,
                xtreamId: row.xtream_id,
                hidden: row.hidden,
                complete: status === 'completed',
            }));
        })
    );
    const present = ([] as (typeof groups)[number]).concat(...groups);
    const explicit = await readExplicitCatalogVisibility(db, playlistId);
    // Partial catalog rows must not erase the archive's hidden choices.
    const currentCategories = Array.from(
        new Map(
            [...present.filter((row) => row.complete), ...explicit].map(
                ({ categoryType, xtreamId, hidden }) => [
                    `${categoryType}:${xtreamId}`,
                    { categoryType, xtreamId, hidden },
                ]
            )
        ).values()
    );
    const visibility = Array.from(
        new Map(
            [...present, ...explicit].map((row) => [
                `${row.categoryType}:${row.xtreamId}`,
                row,
            ])
        ).values()
    );
    const ids = new Set(
        currentCategories.map((row) => `${row.categoryType}:${row.xtreamId}`)
    );
    return {
        currentCategories,
        hiddenCategories: Array.from(
            new Map(
                [
                    ...fallback.filter(
                        (row) => !ids.has(`${row.categoryType}:${row.xtreamId}`)
                    ),
                    ...visibility
                        .filter((row) => row.hidden)
                        .map(({ categoryType, xtreamId }) => ({
                            categoryType,
                            xtreamId,
                        })),
                ].map((row) => [`${row.categoryType}:${row.xtreamId}`, row])
            ).values()
        ),
    };
}

/** Capture catalog flags before either edit-time or ordinary refresh deletes rows. */
export async function captureCatalogCacheRecoveryState(
    db: Pick<
        DatabaseService,
        'getAllXtreamCategories' | 'getXtreamImportStatus' | 'readAppState'
    >,
    deferred: XtreamDeferredCatalogRestoreService,
    playlistId: string,
    available: readonly XtreamContentType[]
) {
    const visibility = await readCatalogRecoveryVisibility(db, playlistId);
    const state: XtreamPendingRestoreState = {
        favorites: [],
        playbackPositions: [],
        recentlyViewed: [],
        preservePlaybackPositions: true,
        hiddenCategories: visibility.hiddenCategories,
    };
    const prepared = deferred.prepare(
        playlistId,
        state,
        available,
        true,
        false,
        visibility.currentCategories
    );
    return {
        snapshot: prepared.snapshot,
        archivedHistory: prepared.snapshot.state.recentlyViewed,
        state: {
            ...prepared.state,
            recentlyViewed: [],
            hiddenCategories: Array.from(
                new Map(
                    [
                        ...prepared.snapshot.state.hiddenCategories.filter(
                            (row) =>
                                !visibility.currentCategories.some(
                                    (current) =>
                                        current.categoryType ===
                                            row.categoryType &&
                                        current.xtreamId === row.xtreamId
                                )
                        ),
                        ...visibility.hiddenCategories,
                    ].map((row) => [`${row.categoryType}:${row.xtreamId}`, row])
                ).values()
            ),
            catalogSnapshot: {
                key: prepared.snapshot.key,
                generation: prepared.snapshot.generation,
            },
        } satisfies XtreamPendingRestoreState,
    };
}

export async function exportCatalogRecoveryState(
    db: Pick<
        DatabaseService,
        | 'readAppState'
        | 'setAppState'
        | 'getXtreamImportStatus'
        | 'getRecentItemsOrThrow'
        | 'getAllXtreamCategories'
    >,
    positions: Pick<PlaybackPositionService, 'getAllPlaybackPositionsOrThrow'>,
    playlistId: string,
    hiddenFallback: XtreamBackupHiddenCategory[] = [],
    snapshot?: XtreamPendingRestoreState['catalogSnapshot'],
    legacy?: {
        state: XtreamPendingRestoreState;
        deferred: XtreamDeferredCatalogRestoreService;
    }
) {
    const upgraded = legacy
        ? await prepareLegacyCatalogHistoryRecovery(
              db,
              legacy.deferred,
              playlistId,
              legacy.state
          )
        : undefined;
    const [journal, visibility] = await Promise.all([
        readCatalogHistoryRecovery(db, playlistId),
        readCatalogRecoveryVisibility(db, playlistId, hiddenFallback),
    ]);
    const recentlyViewed =
        journal?.recentlyViewed ??
        (await db.getRecentItemsOrThrow(playlistId)).map((row) => ({
            contentType: row.type as XtreamContentType,
            xtreamId: row.xtream_id,
            viewedAt: row.viewed_at ?? new Date().toISOString(),
        }));
    return {
        recentlyViewed,
        historyRecovery: {
            ...(journal ?? { contentTypes: [] }),
            currentCategories: visibility.currentCategories,
            snapshot: snapshot ?? upgraded,
        },
        hiddenCategories: visibility.hiddenCategories,
        playbackPositions:
            await positions.getAllPlaybackPositionsOrThrow(playlistId),
    };
}
