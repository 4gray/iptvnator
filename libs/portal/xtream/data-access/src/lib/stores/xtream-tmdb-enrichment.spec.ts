import type { TmdbEnrichmentService } from '@iptvnator/services';
import {
    enrichSerialSeasonWithTmdb,
    enrichSerialSelectionWithTmdb,
    enrichVodSelectionWithTmdb,
} from './xtream-tmdb-enrichment';

type SelectionRecord = { readonly [key: string]: unknown };

function createStore(initial: SelectionRecord | null) {
    let item = initial;
    return {
        selectedItem: jest.fn(() => item),
        setSelectedItem: jest.fn((next: SelectionRecord | null) => {
            item = next;
        }),
        /** Simulate the user navigating elsewhere mid-flight */
        replaceItem(next: SelectionRecord | null) {
            item = next;
        },
    };
}

function createEnrichment(overrides: Partial<TmdbEnrichmentService> = {}) {
    return {
        isEnabled: jest.fn(() => true),
        enrichMovie: jest.fn().mockResolvedValue(null),
        enrichTv: jest.fn().mockResolvedValue(null),
        getSeasonEpisodes: jest.fn().mockResolvedValue(null),
        ...overrides,
    } as unknown as TmdbEnrichmentService;
}

const vodItem = {
    stream_id: '42',
    info: {
        tmdb_id: 603,
        name: 'The Matrix',
        o_name: 'The Matrix',
        releasedate: '1999-03-31',
        plot: 'Provider plot',
        cast: '',
        actors: '',
        director: '',
        genre: '',
        description: '',
        movie_image: '',
        cover_big: '',
        backdrop_path: [],
        rating: 0,
    },
};

const serialItem = {
    series_id: '7',
    info: {
        name: 'Dark',
        plot: 'Provider plot',
        cast: '',
        director: '',
        genre: '',
        releaseDate: '2017-12-01',
        rating: '0',
        rating_5based: 0,
        cover: '',
        backdrop_path: [],
    },
};

describe('enrichVodSelectionWithTmdb', () => {
    it('does nothing when enrichment is disabled', async () => {
        const store = createStore(vodItem);
        const enrichment = createEnrichment({
            isEnabled: jest.fn(() => false),
        } as Partial<TmdbEnrichmentService>);

        await enrichVodSelectionWithTmdb(store, enrichment, '42');

        expect(enrichment.enrichMovie).not.toHaveBeenCalled();
        expect(store.setSelectedItem).not.toHaveBeenCalled();
    });

    it('skips when the selected item does not match the vod id', async () => {
        const store = createStore(vodItem);
        const enrichment = createEnrichment();

        await enrichVodSelectionWithTmdb(store, enrichment, '99');

        expect(enrichment.enrichMovie).not.toHaveBeenCalled();
    });

    it('merges TMDB details into the selected item', async () => {
        const store = createStore(vodItem);
        const enrichment = createEnrichment({
            enrichMovie: jest.fn().mockResolvedValue({
                id: 603,
                overview: 'TMDB overview',
                vote_average: 8.2,
                vote_count: 26000,
            }),
        } as Partial<TmdbEnrichmentService>);

        await enrichVodSelectionWithTmdb(store, enrichment, '42');

        expect(enrichment.enrichMovie).toHaveBeenCalledWith({
            tmdbId: 603,
            title: 'The Matrix',
            originalTitle: 'The Matrix',
            year: 1999,
        });
        expect(store.setSelectedItem).toHaveBeenCalledTimes(1);
        const updated = store.setSelectedItem.mock.calls[0][0] as {
            stream_id: string;
            info: { plot: string; rating: number };
        };
        expect(updated.stream_id).toBe('42');
        expect(updated.info.plot).toBe('TMDB overview');
        expect(updated.info.rating).toBe(8.2);
    });

    it('drops the result when the user navigated away mid-flight', async () => {
        const store = createStore(vodItem);
        const enrichment = createEnrichment({
            enrichMovie: jest.fn().mockImplementation(async () => {
                store.replaceItem({ stream_id: '99', info: {} });
                return { id: 603, overview: 'TMDB overview' };
            }),
        } as Partial<TmdbEnrichmentService>);

        await enrichVodSelectionWithTmdb(store, enrichment, '42');

        expect(store.setSelectedItem).not.toHaveBeenCalled();
    });

    it('keeps provider data when no confident match was found', async () => {
        const store = createStore(vodItem);
        const enrichment = createEnrichment();

        await enrichVodSelectionWithTmdb(store, enrichment, '42');

        expect(store.setSelectedItem).not.toHaveBeenCalled();
    });
});

describe('enrichSerialSelectionWithTmdb', () => {
    it('merges TMDB tv details into the selected series', async () => {
        const store = createStore(serialItem);
        const enrichment = createEnrichment({
            enrichTv: jest.fn().mockResolvedValue({
                id: 70523,
                overview: 'TMDB tv overview',
            }),
        } as Partial<TmdbEnrichmentService>);

        await enrichSerialSelectionWithTmdb(store, enrichment, '7');

        expect(enrichment.enrichTv).toHaveBeenCalledWith({
            title: 'Dark',
            year: 2017,
        });
        const updated = store.setSelectedItem.mock.calls[0][0] as {
            series_id: string;
            info: { plot: string };
        };
        expect(updated.series_id).toBe('7');
        expect(updated.info.plot).toBe('TMDB tv overview');
    });

    it('skips series items without provider info', async () => {
        const store = createStore({ series_id: '7', info: [] });
        const enrichment = createEnrichment();

        await enrichSerialSelectionWithTmdb(store, enrichment, '7');

        expect(enrichment.enrichTv).not.toHaveBeenCalled();
    });
});

describe('enrichSerialSeasonWithTmdb', () => {
    function seasonSliceItem(
        name: string,
        episodes: Record<string, { episode_num: number; season: number }[]>
    ) {
        return {
            series_id: '7',
            info: { ...serialItem.info, name, tmdb_id: 82856 },
            episodes: Object.fromEntries(
                Object.entries(episodes).map(([key, list]) => [
                    key,
                    list.map((episode) => ({
                        id: `${key}-${episode.episode_num}`,
                        title: `Episode ${episode.episode_num}`,
                        ...episode,
                    })),
                ])
            ),
        };
    }

    it('fetches the title-marked season for a renumbered single-season slice', async () => {
        const store = createStore(
            seasonSliceItem('The Mandalorian (2 season)', {
                '1': [{ episode_num: 1, season: 1 }],
            })
        );
        const enrichment = createEnrichment({
            getSeasonEpisodes: jest
                .fn()
                .mockResolvedValue([
                    { episode_number: 1, name: 'The Marshal' },
                ]),
        } as Partial<TmdbEnrichmentService>);

        await enrichSerialSeasonWithTmdb(store, enrichment, '1');

        expect(enrichment.getSeasonEpisodes).toHaveBeenCalledWith(82856, 2);
        const updated = store.setSelectedItem.mock.calls[0][0] as {
            episodes: Record<string, { title: string }[]>;
        };
        expect(updated.episodes['1'][0].title).toBe('The Marshal');
    });

    it('keeps provider numbering for multi-season items despite a marker', async () => {
        const store = createStore(
            seasonSliceItem('The Mandalorian (2 season)', {
                '1': [{ episode_num: 1, season: 1 }],
                '2': [{ episode_num: 1, season: 2 }],
            })
        );
        const enrichment = createEnrichment({
            getSeasonEpisodes: jest.fn().mockResolvedValue([]),
        } as Partial<TmdbEnrichmentService>);

        await enrichSerialSeasonWithTmdb(store, enrichment, '1');

        expect(enrichment.getSeasonEpisodes).toHaveBeenCalledWith(82856, 1);
    });

    it('keeps provider numbering when the title has no marker', async () => {
        const store = createStore(
            seasonSliceItem('The Mandalorian', {
                '1': [{ episode_num: 1, season: 1 }],
            })
        );
        const enrichment = createEnrichment({
            getSeasonEpisodes: jest.fn().mockResolvedValue([]),
        } as Partial<TmdbEnrichmentService>);

        await enrichSerialSeasonWithTmdb(store, enrichment, '1');

        expect(enrichment.getSeasonEpisodes).toHaveBeenCalledWith(82856, 1);
    });
});
