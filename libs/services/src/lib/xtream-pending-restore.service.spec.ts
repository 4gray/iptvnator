import { getXtreamPendingRestoreStorageKey } from '@iptvnator/shared/interfaces';
import { XtreamPendingRestoreService } from './xtream-pending-restore.service';

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
        service.set(playlistId, {
            hiddenCategories: [
                { categoryType: 'live', xtreamId: 101 },
                { categoryType: 'live' } as never,
            ],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [],
        });

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
});
