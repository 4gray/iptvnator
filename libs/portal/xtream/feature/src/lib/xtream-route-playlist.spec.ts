import {
    PlaylistMeta,
    XTREAM_CONTENT_TYPES,
} from '@iptvnator/shared/interfaces';
import {
    shouldBootstrapXtreamPlaylist,
    toXtreamPlaylistData,
} from './xtream-route-playlist';

const source = {
    _id: 'source',
    title: 'Source',
    serverUrl: 'https://example.invalid',
    username: 'user',
    password: 'password',
    userAgent: ' Player ',
    xtreamContentTypes: ['live'],
} as PlaylistMeta;

describe('Xtream route playlist metadata', () => {
    it('retains catalog selections alongside normalized connection headers', () => {
        expect(toXtreamPlaylistData(source)).toMatchObject({
            id: source._id,
            userAgent: 'Player',
            xtreamContentTypes: ['live'],
        });
    });

    it('reboots the active source when its catalog selection changes without a timestamp change', () => {
        const current = toXtreamPlaylistData(source);
        const next = toXtreamPlaylistData({
            ...source,
            xtreamContentTypes: [],
        });
        expect(
            shouldBootstrapXtreamPlaylist(source._id, next, source._id, current)
        ).toBe(true);
    });

    it('keeps legacy all-catalog settings equivalent to explicit all-catalog settings', () => {
        const current = toXtreamPlaylistData({
            ...source,
            xtreamContentTypes: undefined,
        });
        const next = toXtreamPlaylistData({
            ...source,
            xtreamContentTypes: [...XTREAM_CONTENT_TYPES].reverse(),
        });
        expect(
            shouldBootstrapXtreamPlaylist(source._id, next, source._id, current)
        ).toBe(false);
    });
});
