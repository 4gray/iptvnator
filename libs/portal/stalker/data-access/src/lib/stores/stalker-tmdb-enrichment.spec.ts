import {
    TmdbMatchService,
    type TmdbEnrichmentService,
} from '@iptvnator/services';
import type { StalkerVodSource } from '../models';
import { enrichStalkerSelectionWithTmdb } from './stalker-tmdb-enrichment';

const identity = {
    provider: 'stalker' as const,
    playlistId: 'source',
    mediaType: 'tv' as const,
    itemId: '42',
};
const original = {
    name: 'Красота (8 серий)',
    description: 'Provider plot',
    movie_image: 'provider.jpg',
    releasedate: '2026',
    actors: 'Provider actors',
    director: 'Provider director',
    genre: 'Drama',
    rating_imdb: '',
    rating_kinopoisk: '',
};

afterEach(() => localStorage.clear());

function fixture() {
    let selected: StalkerVodSource = {
        id: '42',
        is_series: true,
        info: original,
    };
    let playlistId = 'source';
    const matches = new TmdbMatchService();
    const store = {
        selectedItem: () => selected,
        currentPlaylist: () => ({ _id: playlistId }),
        selectedContentType: () => 'vod',
    };
    const apply = jest.fn((next: StalkerVodSource) => {
        selected = next;
    });
    const enrichTv = jest.fn(async () => {
        const choice = matches.read(identity);
        return choice?.mode === 'provider'
            ? null
            : {
                  id: choice?.mode === 'manual' ? choice.tmdbId : 273160,
                  overview:
                      choice?.mode === 'manual'
                          ? 'Chosen plot'
                          : 'Automatic plot',
                  poster_path: '/poster.jpg',
              };
    });
    const enrichment = {
        isEnabled: () => true,
        matches,
        enrichTv,
    } as unknown as TmdbEnrichmentService;
    return {
        store,
        matches,
        apply,
        enrichment,
        enrichTv,
        switchSource: () => {
            playlistId = 'other';
        },
        run: () =>
            enrichStalkerSelectionWithTmdb(
                store,
                enrichment,
                selected,
                'tv',
                apply
            ),
    };
}

it('restores original Stalker metadata and preserves it through enriched snapshots', async () => {
    const context = fixture();
    await context.run();
    expect(context.store.selectedItem().info?.description).toBe(
        'Automatic plot'
    );
    expect(context.store.selectedItem().info?.tmdb_provider_info).toEqual(
        original
    );
    await context.matches.save(identity, {
        mode: 'manual',
        tmdbId: 318158,
        title: 'Красота',
    });
    expect(context.store.selectedItem().info?.description).toBe('Chosen plot');
    await context.run(); // Reopen the enriched snapshot.
    expect(context.store.selectedItem().info?.tmdb_provider_info).toEqual(
        original
    );
    await context.matches.save(identity, { mode: 'provider' });
    expect(context.store.selectedItem().info).toEqual(original);
    expect(context.store.selectedItem().id).toBe('42');
    await context.matches.save(identity, null);
    expect(context.store.selectedItem().info?.description).toBe(
        'Automatic plot'
    );
});

it('does not apply an old source choice to a different source with the same provider id', async () => {
    const context = fixture();
    await context.run();
    context.switchSource();
    context.apply.mockClear();
    await context.matches.save(identity, { mode: 'provider' });
    expect(context.apply).not.toHaveBeenCalled();
});

it('drops an automatic response which arrives after a provider-only choice', async () => {
    const context = fixture();
    let finish: (details: {
        id: number;
        overview: string;
        poster_path: string;
    }) => void = () => undefined;
    context.enrichTv.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            })
    );
    const pending = context.run();
    await context.matches.save(identity, { mode: 'provider' });
    finish({
        id: 273160,
        overview: 'Late wrong plot',
        poster_path: '/late.jpg',
    });
    await pending;
    expect(context.store.selectedItem().info).toEqual(original);
});
