import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import {
    DataService,
    DatabaseService,
    XtreamPendingRestoreService,
    XtreamPendingRestoreSnapshot,
} from '@iptvnator/services';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../../data-sources/xtream-data-source.interface';
import { XtreamApiService } from '../../services/xtream-api.service';
import { PortalStatusType } from '../../xtream-state';
import { withContent } from './with-content.feature';

export const TEST_PLAYLIST: XtreamPlaylistData = {
    id: 'playlist-1',
    name: 'Test Xtream',
    serverUrl: 'http://localhost:8080',
    username: 'demo',
    password: 'secret',
    type: 'xtream',
};

export const PENDING_RESTORE_STATE: XtreamPendingRestoreState = {
    hiddenCategories: [],
    favorites: [{ contentType: 'live', xtreamId: 77 }],
    recentlyViewed: [],
    playbackPositions: [],
    sourcePins: [{ matchKey: 'tmdb:603', contentId: 501 }],
};

export function createPendingRestoreServiceMock() {
    let nextRevision = 0;
    let activeSnapshot: XtreamPendingRestoreSnapshot | null = null;
    let activeSerializedState: string | null = null;
    let lastConsumedRevision: number | null = null;
    const mock = {
        getOrThrow: jest.fn().mockReturnValue(null),
        getSnapshotOrThrow: jest.fn(),
        clear: jest.fn().mockReturnValue(true),
        applyAndConsume: jest.fn(),
    };
    mock.getSnapshotOrThrow.mockImplementation((playlistId: string) => {
        const state = mock.getOrThrow(
            playlistId
        ) as XtreamPendingRestoreState | null;
        if (!state) {
            activeSnapshot = null;
            activeSerializedState = null;
            return null;
        }

        const serializedState = JSON.stringify(state);
        if (!activeSnapshot || activeSerializedState !== serializedState) {
            activeSnapshot = {
                playlistId,
                revision: ++nextRevision,
                state,
            };
            activeSerializedState = serializedState;
            lastConsumedRevision = null;
        }
        return activeSnapshot;
    });
    mock.applyAndConsume.mockImplementation(
        async (
            playlistId: string,
            expectedSnapshot: XtreamPendingRestoreSnapshot,
            apply: (state: XtreamPendingRestoreState) => Promise<void>
        ) => {
            const currentSnapshot = mock.getSnapshotOrThrow(playlistId);
            if (!currentSnapshot) {
                return lastConsumedRevision === expectedSnapshot.revision
                    ? 'consumed'
                    : 'superseded';
            }
            if (currentSnapshot.revision !== expectedSnapshot.revision) {
                return 'superseded';
            }

            await apply(currentSnapshot.state);
            if (!mock.clear(playlistId, currentSnapshot.state)) {
                return 'consume-failed';
            }
            lastConsumedRevision = currentSnapshot.revision;
            activeSnapshot = null;
            activeSerializedState = null;
            mock.getOrThrow.mockReturnValue(null);
            return 'consumed';
        }
    );
    return mock;
}

export function createContentTestStore(
    checkPortalStatus: () => Promise<PortalStatusType>
) {
    return signalStore(
        withState({
            playlistId: TEST_PLAYLIST.id,
            currentPlaylist: TEST_PLAYLIST,
            portalStatus: 'active' as PortalStatusType,
            selectedContentType: 'vod' as const,
        }),
        withMethods((store) => ({
            async checkPortalStatus(): Promise<PortalStatusType> {
                const status = await checkPortalStatus();
                patchState(store, { portalStatus: status });
                return status;
            },
        })),
        withContent()
    );
}

/**
 * The provider list every `withContent` spec needs. Shared so the dependency
 * set lives in one place: the feature injects all five, and a spec that omits
 * one fails with a NullInjector error rather than a useful message.
 */
export function createContentTestProviders(
    store: unknown,
    mocks: {
        dataSource: unknown;
        databaseService: unknown;
        xtreamApiService: unknown;
        pendingRestoreService: unknown;
        dataService: unknown;
    }
) {
    return [
        store,
        { provide: XTREAM_DATA_SOURCE, useValue: mocks.dataSource },
        { provide: DatabaseService, useValue: mocks.databaseService },
        { provide: XtreamApiService, useValue: mocks.xtreamApiService },
        {
            provide: XtreamPendingRestoreService,
            useValue: mocks.pendingRestoreService,
        },
        { provide: DataService, useValue: mocks.dataService },
    ];
}

const performanceHookSymbol = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);

export function setPerformanceHook(
    hook: ((event: RendererPerformancePhaseEvent) => void) | null
): void {
    const target = globalThis as unknown as Record<symbol, unknown>;
    if (hook === null) {
        delete target[performanceHookSymbol];
    } else {
        target[performanceHookSymbol] = hook;
    }
}

export function readPendingRestoreBlocked(store: unknown): boolean {
    return (
        store as {
            isPendingRestoreBlocked: () => boolean;
        }
    ).isPendingRestoreBlocked();
}

export function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

export function createAbortError(): Error {
    const error = new Error('Import cancelled');
    error.name = 'AbortError';
    return error;
}

export async function waitForCondition(
    predicate: () => boolean,
    attempts = 20
): Promise<void> {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) {
            return;
        }

        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throw new Error('Timed out waiting for test condition');
}
