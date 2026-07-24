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
});
