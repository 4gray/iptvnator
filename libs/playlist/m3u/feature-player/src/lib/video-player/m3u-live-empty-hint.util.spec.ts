import { m3uLiveEmptyHintKey } from './m3u-live-empty-hint.util';

const catalog = (
    overrides: Partial<{ splits: boolean; live: number; movies: number }> = {}
) => {
    const { splits = true, live = 0, movies = 3 } = overrides;
    return {
        splitsCatalog: () => splits,
        liveChannels: () => new Array(live).fill({}),
        index: () => ({ counts: { movie: movies } }),
    };
};

describe('m3uLiveEmptyHintKey', () => {
    it('points to Movies when a split playlist has films and no channels', () => {
        expect(m3uLiveEmptyHintKey('all', false, catalog())).toBe(
            'CHANNELS.CATALOG.EMPTY_HINT_MOVIES'
        );
        expect(m3uLiveEmptyHintKey('groups', false, catalog())).toBe(
            'CHANNELS.CATALOG.EMPTY_HINT_MOVIES'
        );
    });

    it('points to Series when the playlist holds only episodes', () => {
        expect(m3uLiveEmptyHintKey('all', false, catalog({ movies: 0 }))).toBe(
            'CHANNELS.CATALOG.EMPTY_HINT_SERIES'
        );
    });

    it('says nothing when the plain empty state is the right one', () => {
        // Favorites and Recent list stored rows, not the live list.
        expect(m3uLiveEmptyHintKey('favorites', false, catalog())).toBeNull();
        expect(m3uLiveEmptyHintKey('recent', false, catalog())).toBeNull();
        // Still loading: the list is not empty yet, it is unknown.
        expect(m3uLiveEmptyHintKey('all', true, catalog())).toBeNull();
        // Not split: every row is in the list, so empty means empty.
        expect(
            m3uLiveEmptyHintKey('all', false, catalog({ splits: false }))
        ).toBeNull();
        // Has channels.
        expect(
            m3uLiveEmptyHintKey('all', false, catalog({ live: 2 }))
        ).toBeNull();
    });
});
