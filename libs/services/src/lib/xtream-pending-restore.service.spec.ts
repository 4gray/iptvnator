import { getXtreamPendingRestoreStorageKey } from '@iptvnator/shared/interfaces';
import {
    XtreamPendingRestoreService,
    XtreamPendingRestoreSnapshot,
} from './xtream-pending-restore.service';

function requireSnapshot(
    snapshot: XtreamPendingRestoreSnapshot | null
): XtreamPendingRestoreSnapshot {
    if (!snapshot) {
        throw new Error('Expected pending restore snapshot');
    }
    return snapshot;
}

describe('XtreamPendingRestoreService', () => {
    const playlistId = 'playlist-1';
    const storageKey = getXtreamPendingRestoreStorageKey(playlistId);
    let service: XtreamPendingRestoreService;

    beforeEach(() => {
        service = new XtreamPendingRestoreService();
        localStorage.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('sanitizes stale persisted state written by broken builds on read', () => {
        // State persisted by versions affected by issue #1017: hidden
        // categories without any xtream ID.
        localStorage.setItem(
            storageKey,
            JSON.stringify({
                hiddenCategories: [
                    { categoryType: 'live' },
                    { categoryType: 'movies' },
                    { categoryType: 'series', xtreamId: 301 },
                ],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            })
        );

        expect(service.get(playlistId)?.hiddenCategories).toEqual([
            { categoryType: 'series', xtreamId: 301 },
        ]);
    });

    it('normalizes state on write', () => {
        const snapshot = service.set(playlistId, {
            hiddenCategories: [
                { categoryType: 'live', xtreamId: 101 },
                { categoryType: 'live' } as never,
            ],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [],
        });

        expect(snapshot).not.toBeNull();
        const persisted = JSON.parse(
            localStorage.getItem(storageKey) ?? 'null'
        );
        expect(persisted?.hiddenCategories).toEqual([
            { categoryType: 'live', xtreamId: 101 },
        ]);
    });

    it('returns null for missing or unreadable state', () => {
        expect(service.get(playlistId)).toBeNull();

        localStorage.setItem(storageKey, '{not json');
        expect(service.get(playlistId)).toBeNull();
    });

    it('offers a strict read that reports storage access failures', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage is locked');
        });

        expect(service.get(playlistId)).toBeNull();
        expect(() => service.getOrThrow(playlistId)).toThrow(
            'storage is locked'
        );
    });

    it('clears persisted state and reports that it was consumed', () => {
        service.set(playlistId, {
            hiddenCategories: [],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [],
        });

        expect(service.clear(playlistId)).toBe(true);
        expect(service.get(playlistId)).toBeNull();
        expect(localStorage.getItem(storageKey)).toBeNull();
    });

    it.each([
        {
            failure: 'throws',
            remove: () => {
                throw new Error('storage is locked');
            },
        },
        {
            failure: 'does not remove the key',
            remove: () => undefined,
        },
    ])(
        'consumes state with a tombstone when removeItem $failure',
        ({ remove }) => {
            service.set(playlistId, {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            });
            jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(
                remove
            );

            expect(service.clear(playlistId)).toBe(true);
            expect(service.get(playlistId)).toBeNull();
            expect(localStorage.getItem(storageKey)).toBe('');
        }
    );

    it('reports failure when state can neither be tombstoned nor removed', () => {
        service.set(playlistId, {
            hiddenCategories: [],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [],
        });
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage is locked');
        });
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('storage is locked');
        });

        expect(service.clear(playlistId)).toBe(false);
        expect(service.get(playlistId)).not.toBeNull();
    });

    it('does not clear a newer snapshot than the one already restored', () => {
        const restoredState = {
            hiddenCategories: [],
            favorites: [{ xtreamId: 101, contentType: 'live' as const }],
            recentlyViewed: [],
            playbackPositions: [],
        };
        const newerState = {
            ...restoredState,
            favorites: [{ xtreamId: 202, contentType: 'movie' as const }],
        };
        service.set(playlistId, newerState);

        expect(service.clear(playlistId, restoredState)).toBe(false);
        expect(service.getOrThrow(playlistId)).toEqual(newerState);
    });

    it('leaves a newer snapshot for its own queued consumer', async () => {
        const olderState = {
            hiddenCategories: [],
            favorites: [{ xtreamId: 101, contentType: 'live' as const }],
            recentlyViewed: [],
            playbackPositions: [],
        };
        const newerState = {
            ...olderState,
            favorites: [{ xtreamId: 202, contentType: 'movie' as const }],
        };
        let releaseOlder!: () => void;
        const olderCanFinish = new Promise<void>((resolve) => {
            releaseOlder = resolve;
        });
        let signalOlderStarted!: () => void;
        const olderStarted = new Promise<void>((resolve) => {
            signalOlderStarted = resolve;
        });
        const appliedSnapshots: number[] = [];

        const olderSnapshot = requireSnapshot(
            service.set(playlistId, olderState)
        );
        const olderApplication = service.applyAndConsume(
            playlistId,
            olderSnapshot,
            async (state) => {
                const xtreamId = state.favorites[0]?.xtreamId;
                signalOlderStarted();
                await olderCanFinish;
                appliedSnapshots.push(xtreamId);
            }
        );
        await olderStarted;

        const newerSnapshot = requireSnapshot(
            service.set(playlistId, newerState)
        );
        const newerApply = jest.fn(async (state) => {
            appliedSnapshots.push(state.favorites[0]?.xtreamId);
        });
        const newerApplication = service.applyAndConsume(
            playlistId,
            newerSnapshot,
            newerApply
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(newerApply).not.toHaveBeenCalled();

        releaseOlder();
        await expect(olderApplication).resolves.toBe('superseded');
        await expect(newerApplication).resolves.toBe('consumed');
        expect(appliedSnapshots).toEqual([101, 202]);
        expect(newerApply).toHaveBeenCalledTimes(1);
        expect(service.getOrThrow(playlistId)).toBeNull();
    });

    it('coalesces concurrent consumers of the same snapshot', async () => {
        const state = {
            hiddenCategories: [],
            favorites: [{ xtreamId: 101, contentType: 'live' as const }],
            recentlyViewed: [],
            playbackPositions: [],
        };
        let releaseFirst!: () => void;
        const firstCanFinish = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let signalFirstStarted!: () => void;
        const firstStarted = new Promise<void>((resolve) => {
            signalFirstStarted = resolve;
        });
        const firstApply = jest.fn(async () => {
            signalFirstStarted();
            await firstCanFinish;
        });
        const secondApply = jest.fn().mockResolvedValue(undefined);

        const snapshot = requireSnapshot(service.set(playlistId, state));
        const firstApplication = service.applyAndConsume(
            playlistId,
            snapshot,
            firstApply
        );
        await firstStarted;
        const secondApplication = service.applyAndConsume(
            playlistId,
            snapshot,
            secondApply
        );

        releaseFirst();
        await expect(firstApplication).resolves.toBe('consumed');
        await expect(secondApplication).resolves.toBe('consumed');
        expect(firstApply).toHaveBeenCalledTimes(1);
        expect(secondApply).not.toHaveBeenCalled();
    });

    it('does not consume an identical snapshot parked by a newer producer', async () => {
        const state = {
            hiddenCategories: [],
            favorites: [{ xtreamId: 101, contentType: 'live' as const }],
            recentlyViewed: [],
            playbackPositions: [],
        };
        let releaseOlder!: () => void;
        const olderCanFinish = new Promise<void>((resolve) => {
            releaseOlder = resolve;
        });
        let signalOlderStarted!: () => void;
        const olderStarted = new Promise<void>((resolve) => {
            signalOlderStarted = resolve;
        });
        const olderSnapshot = requireSnapshot(
            service.set(playlistId, state)
        );
        const olderApplication = service.applyAndConsume(
            playlistId,
            olderSnapshot,
            async () => {
                signalOlderStarted();
                await olderCanFinish;
            }
        );
        await olderStarted;

        const newerSnapshot = requireSnapshot(
            service.set(playlistId, state)
        );
        expect(newerSnapshot.revision).not.toBe(olderSnapshot.revision);
        releaseOlder();

        await expect(
            olderApplication
        ).resolves.toBe('superseded');
        expect(service.getSnapshotOrThrow(playlistId)).toEqual(newerSnapshot);
    });

    it('continues the playlist queue after an application rejects', async () => {
        const olderState = {
            hiddenCategories: [],
            favorites: [{ xtreamId: 101, contentType: 'live' as const }],
            recentlyViewed: [],
            playbackPositions: [],
        };
        const newerState = {
            ...olderState,
            favorites: [{ xtreamId: 202, contentType: 'movie' as const }],
        };
        const olderSnapshot = requireSnapshot(
            service.set(playlistId, olderState)
        );

        await expect(
            service.applyAndConsume(
                playlistId,
                olderSnapshot,
                async () => {
                    throw new Error('database is locked');
                }
            )
        ).rejects.toThrow('database is locked');
        const newerSnapshot = requireSnapshot(
            service.set(playlistId, newerState)
        );
        const applyNewer = jest.fn().mockResolvedValue(undefined);

        await expect(
            service.applyAndConsume(
                playlistId,
                newerSnapshot,
                applyNewer
            )
        ).resolves.toBe('consumed');
        expect(applyNewer).toHaveBeenCalledTimes(1);
    });

    it('reports failure when an applied snapshot cannot be consumed', async () => {
        const state = {
            hiddenCategories: [],
            favorites: [{ xtreamId: 101, contentType: 'live' as const }],
            recentlyViewed: [],
            playbackPositions: [],
        };
        const snapshot = requireSnapshot(service.set(playlistId, state));
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage is locked');
        });
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('storage is locked');
        });
        const apply = jest.fn().mockResolvedValue(undefined);

        await expect(
            service.applyAndConsume(playlistId, snapshot, apply)
        ).resolves.toBe('consume-failed');
        expect(apply).toHaveBeenCalledWith(state);
        expect(service.getOrThrow(playlistId)).toEqual(state);
    });

    it('reports failure when pending state cannot be parked', () => {
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage is locked');
        });

        expect(
            service.set(playlistId, {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            })
        ).toBeNull();
        expect(service.getOrThrow(playlistId)).toBeNull();
    });
});
