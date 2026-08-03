import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { StalkerMappedEpisode } from '@iptvnator/portal/stalker/data-access';
import { STALKER_SERIES_DOWNLOAD_MODES } from './stalker-series-download.adapter';
import { createStalkerEpisodePlaybackSessionKey } from './stalker-episode-playback-session-key';

const episodeState = (
    episode: Partial<StalkerMappedEpisode>,
    seasonKey = 'season|1'
) => ({
    seasonKey,
    seasonNumber: 1,
    episodeNumber: 2,
    episode: {
        id: 'synthesized-32-bit-id',
        title: 'Episode 2',
        episode_num: 2,
        season: 1,
        ...episode,
    } as StalkerMappedEpisode,
    previous: null,
    next: null,
});

describe('createStalkerEpisodePlaybackSessionKey', () => {
    it.each([
        STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
        STALKER_SERIES_DOWNLOAD_MODES.EmbeddedVod,
    ])('uses the complete source command for %s episodes', (seriesMode) => {
        const state = episodeState({ originalCmd: 'ffrt4://cmd|full:2' });
        const composite = JSON.stringify([
            seriesMode,
            'parent|series',
            state.seasonKey,
            state.seasonNumber,
            state.episodeNumber,
            'ffrt4://cmd|full:2',
        ]);

        expect(
            createStalkerEpisodePlaybackSessionKey({
                sourceId: 'playlist|source',
                parentSeriesId: 'parent|series',
                seriesMode,
                episodeState: state,
            })
        ).toBe(
            createPlaybackSessionKey({
                kind: 'episode',
                sourceId: 'playlist|source',
                contentId: composite,
                seriesId: 'parent|series',
                seasonNumber: 1,
                episodeNumber: 2,
            })
        );
    });

    it('uses the complete provider episode id for lazy VOD episodes', () => {
        const state = episodeState({ originalId: 'provider|episode:full' });
        const key = createStalkerEpisodePlaybackSessionKey({
            sourceId: 'playlist',
            parentSeriesId: '50001',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.LazyVod,
            episodeState: state,
        });

        expect(key).toContain('provider|episode:full');
        expect(key).not.toContain('synthesized-32-bit-id');
    });

    it('separates parent, mode, season, command, and episode identity without delimiter collisions', () => {
        const base = {
            sourceId: 'playlist',
            parentSeriesId: 'parent|a',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            episodeState: episodeState({ originalCmd: 'cmd|a' }),
        } as const;
        const variants = [
            { ...base, parentSeriesId: 'parent|b' },
            {
                ...base,
                seriesMode: STALKER_SERIES_DOWNLOAD_MODES.EmbeddedVod,
            },
            {
                ...base,
                episodeState: episodeState(
                    { originalCmd: 'cmd|a' },
                    'season|2'
                ),
            },
            { ...base, episodeState: episodeState({ originalCmd: 'cmd|b' }) },
            {
                ...base,
                episodeState: {
                    ...base.episodeState,
                    episodeNumber: 3,
                },
            },
        ];
        const baseKey = createStalkerEpisodePlaybackSessionKey(base);

        expect(
            variants.map(createStalkerEpisodePlaybackSessionKey)
        ).not.toContain(baseKey);
    });

    it.each([episodeState({}), episodeState({ originalCmd: '' })])(
        'fails closed when original episode identity is absent',
        (state) => {
            expect(
                createStalkerEpisodePlaybackSessionKey({
                    sourceId: 'playlist',
                    parentSeriesId: 'series',
                    seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
                    episodeState: state,
                })
            ).toBe('');
        }
    );
});
