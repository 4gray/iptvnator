import { combineUserData } from './server-migration-merge';
import { typeLegacyXtreamRefs } from './server-migration-xtream';

describe('typeLegacyXtreamRefs', () => {
    it('types bare ids from the same copy snapshots', () => {
        expect(
            typeLegacyXtreamRefs({
                'xtream-favorites': [42, 'movie:7', 99],
                'xtream-recent-items': [{ id: 42, viewedAt: 't' }],
                'xtream-collection-items': {
                    '42': { xtream_id: 42, type: 'live', title: 'News' },
                    'movie:7': { xtream_id: 7, type: 'movie' },
                },
            })
        ).toEqual({
            'xtream-favorites': ['live:42', 'movie:7', 99],
            'xtream-recent-items': [{ id: 'live:42', viewedAt: 't' }],
            'xtream-collection-items': {
                '42': { xtream_id: 42, type: 'live', title: 'News' },
                'live:42': { xtream_id: 42, type: 'live', title: 'News' },
                'movie:7': { xtream_id: 7, type: 'movie' },
            },
        });
    });

    it('keeps a live and a movie favorite that share an id apart', () => {
        const browser = typeLegacyXtreamRefs({
            'xtream-favorites': [42],
            'xtream-collection-items': {
                '42': { xtream_id: 42, type: 'live' },
            },
        });
        const server = typeLegacyXtreamRefs({
            'xtream-favorites': [42],
            'xtream-collection-items': {
                '42': { xtream_id: 42, type: 'movie' },
            },
        });

        expect(
            combineUserData([
                server['xtream-favorites'],
                browser['xtream-favorites'],
            ])
        ).toEqual(['movie:42', 'live:42']);
        expect(
            combineUserData([
                server['xtream-collection-items'],
                browser['xtream-collection-items'],
            ])
        ).toEqual({
            // The server's own bare alias wins its key; both typed keys stay.
            '42': { xtream_id: 42, type: 'movie' },
            'movie:42': { xtream_id: 42, type: 'movie' },
            'live:42': { xtream_id: 42, type: 'live' },
        });
    });

    it('types numeric-string ids too', () => {
        expect(
            typeLegacyXtreamRefs({
                'xtream-favorites': ['42'],
                'xtream-collection-items': {
                    '42': { xtream_id: 42, type: 'movie' },
                },
            })['xtream-favorites']
        ).toEqual(['movie:42']);
    });

    it('keeps a typed snapshot newer than its legacy alias', () => {
        const typed = typeLegacyXtreamRefs({
            'xtream-favorites': ['movie:42'],
            'xtream-collection-items': {
                '42': { xtream_id: 42, type: 'movie', backdrop: 'old' },
                'movie:42': { xtream_id: 42, type: 'movie', backdrop: 'new' },
            },
        });

        expect(typed['xtream-collection-items']).toEqual({
            '42': { xtream_id: 42, type: 'movie', backdrop: 'old' },
            'movie:42': { xtream_id: 42, type: 'movie', backdrop: 'new' },
        });
    });
});
