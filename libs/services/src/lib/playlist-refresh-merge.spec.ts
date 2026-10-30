import type { Playlist } from '@iptvnator/shared/interfaces';
import { mergeRefreshedPlaylist } from './playlist-refresh-merge';

describe('canonical playlist refresh merge', () => {
    const current = {
        _id: 'm3u',
        title: 'Current title',
        url: 'https://provider.test/list',
        userAgent: 'Current agent',
        favorites: ['local'],
        recentlyViewed: [{ id: 'local-history' }],
        position: 5,
        playlist: { items: [{ id: 'current' }] },
        count: 1,
    } as Playlist;
    it('returns the current cache unchanged when the response belongs to an older connection', () => {
        const delayed = {
            ...current,
            url: 'https://old.test/list',
            playlist: { items: [] },
        };
        expect(mergeRefreshedPlaylist(current, delayed, current._id)).toBe(
            current
        );
    });
    it('accepts fresh parsed channels while retaining the current name and activity', () => {
        const refreshed = {
            ...current,
            title: 'Old title',
            favorites: [],
            recentlyViewed: [],
            playlist: { items: [{ id: 'fresh' }] },
        } as Playlist;
        expect(
            mergeRefreshedPlaylist(current, refreshed, current._id)
        ).toMatchObject({
            title: current.title,
            favorites: current.favorites,
            recentlyViewed: current.recentlyViewed,
            position: 5,
            playlist: refreshed.playlist,
        });
    });
});
