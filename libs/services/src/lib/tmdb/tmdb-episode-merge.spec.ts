import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { mergeEpisodesWithTmdb } from './tmdb-episode-merge';
import { TmdbEpisode } from './tmdb.types';

function providerEpisode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '1001',
        episode_num: 4,
        title: 'Episode 4',
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
        ...overrides,
    };
}

const tmdbEpisode: TmdbEpisode = {
    episode_number: 4,
    season_number: 1,
    name: 'The Female of the Species',
    overview: 'TMDB episode overview',
    still_path: '/still.jpg',
    air_date: '2019-08-16',
    vote_average: 8.1,
    vote_count: 500,
};

describe('mergeEpisodesWithTmdb', () => {
    it('replaces generic titles and fills editorial fields', () => {
        const [merged] = mergeEpisodesWithTmdb(
            [providerEpisode()],
            [tmdbEpisode]
        );

        expect(merged.title).toBe('The Female of the Species');
        const info = merged.info as Exclude<
            XtreamSerieEpisode['info'],
            unknown[]
        >;
        expect(info.plot).toBe('TMDB episode overview');
        expect(info.movie_image).toBe(
            'https://image.tmdb.org/t/p/w300/still.jpg'
        );
        expect(info.releasedate).toBe('2019-08-16');
        expect(info.rating).toBe(8.1);
    });

    it('recognizes localized and SxxEyy generic titles', () => {
        const cases = ['Серия 4', 'S01E04', '4', ''];
        for (const title of cases) {
            const [merged] = mergeEpisodesWithTmdb(
                [providerEpisode({ title })],
                [tmdbEpisode]
            );
            expect(merged.title).toBe('The Female of the Species');
        }
    });

    it('keeps a meaningful provider title', () => {
        const [merged] = mergeEpisodesWithTmdb(
            [providerEpisode({ title: 'Особый эпизод — финал' })],
            [tmdbEpisode]
        );
        expect(merged.title).toBe('Особый эпизод — финал');
    });

    it('keeps provider info fields that TMDB should not overwrite', () => {
        const [merged] = mergeEpisodesWithTmdb(
            [
                providerEpisode({
                    info: {
                        releasedate: '2019-01-01',
                        rating: 6,
                        duration: '00:55:00',
                        duration_secs: 3300,
                    },
                }),
            ],
            [tmdbEpisode]
        );

        const info = merged.info as Exclude<
            XtreamSerieEpisode['info'],
            unknown[]
        >;
        expect(info.releasedate).toBe('2019-01-01');
        expect(info.rating).toBe(6);
        expect(info.duration).toBe('00:55:00');
        expect(info.duration_secs).toBe(3300);
    });

    it('passes through episodes without a TMDB counterpart', () => {
        const episode = providerEpisode({ episode_num: 99 });
        const [merged] = mergeEpisodesWithTmdb([episode], [tmdbEpisode]);
        expect(merged).toBe(episode);
    });

    it('returns a copy when TMDB has no episodes', () => {
        const episodes = [providerEpisode()];
        const merged = mergeEpisodesWithTmdb(episodes, []);
        expect(merged).toEqual(episodes);
        expect(merged).not.toBe(episodes);
    });
});
