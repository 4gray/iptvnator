import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    resolveEpisodeMetaState,
    usableStillUrl,
} from './episode-meta-state.util';

const SERIES_POSTER = 'https://img.test/series.jpg';
const SEASON_COVER = 'https://img.test/season-1.jpg';

const episode = (
    id: number,
    info: { plot?: string; movie_image?: string } = {}
): XtreamSerieEpisode =>
    ({
        id: String(id),
        episode_num: id,
        title: `Episode ${id}`,
        container_extension: 'mp4',
        info,
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
    }) as XtreamSerieEpisode;

const context = (distinctStills = true) => ({
    distinctStills,
    posterUrls: [SERIES_POSTER, SEASON_COVER],
});

describe('usableStillUrl', () => {
    it('keeps an episode still of its own', () => {
        expect(
            usableStillUrl(
                episode(1, { movie_image: 'https://img.test/e1.jpg' }),
                context()
            )
        ).toBe('https://img.test/e1.jpg');
    });

    it('treats the series poster or the season cover as no still', () => {
        expect(
            usableStillUrl(
                episode(1, { movie_image: SERIES_POSTER }),
                context()
            )
        ).toBeNull();
        expect(
            usableStillUrl(
                episode(1, { movie_image: ` ${SEASON_COVER} ` }),
                context()
            )
        ).toBeNull();
    });

    it('treats one image repeated across the season as no still', () => {
        expect(
            usableStillUrl(
                episode(1, { movie_image: 'https://img.test/same.jpg' }),
                context(false)
            )
        ).toBeNull();
    });
});

describe('resolveEpisodeMetaState', () => {
    const listLoading = { list: true, metadata: false };
    const metadataLoading = { list: false, metadata: true };
    const settled = { list: false, metadata: false };

    it('stays loading while the provider list is outstanding, whatever it holds', () => {
        expect(
            resolveEpisodeMetaState([episode(1)], listLoading, context())
        ).toBe('loading');
        expect(resolveEpisodeMetaState([], listLoading, context())).toBe(
            'loading'
        );
    });

    it('waits for metadata only when the data would render bare', () => {
        const bare = [episode(1, { movie_image: SERIES_POSTER })];
        const described = [
            episode(1, { plot: 'Plot', movie_image: 'https://img.test/1.jpg' }),
        ];

        expect(resolveEpisodeMetaState(bare, metadataLoading, context())).toBe(
            'loading'
        );
        expect(
            resolveEpisodeMetaState(described, metadataLoading, context())
        ).toBe('full');
        expect(resolveEpisodeMetaState([], metadataLoading, context())).toBe(
            'full'
        );
    });

    it('is bare when no episode has a plot or a usable still', () => {
        const episodes = [
            episode(1, { movie_image: SERIES_POSTER }),
            episode(2, { plot: '   ' }),
            episode(3),
        ];
        expect(resolveEpisodeMetaState(episodes, settled, context())).toBe(
            'bare'
        );
    });

    it('is full when only some episodes lack a still or a plot', () => {
        expect(
            resolveEpisodeMetaState(
                [episode(1, { plot: 'Something happens.' }), episode(2)],
                settled,
                context()
            )
        ).toBe('full');
        expect(
            resolveEpisodeMetaState(
                [
                    episode(1, { movie_image: 'https://img.test/e1.jpg' }),
                    episode(2),
                ],
                settled,
                context()
            )
        ).toBe('full');
    });

    it('is full for an empty season (the empty state owns that case)', () => {
        expect(resolveEpisodeMetaState([], settled, context())).toBe('full');
    });
});
