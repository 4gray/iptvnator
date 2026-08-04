import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { StalkerMappedEpisode } from '@iptvnator/portal/stalker/data-access';
import { STALKER_SERIES_DOWNLOAD_MODES } from './stalker-series-download.adapter';
import {
    captureStalkerEpisodePlaybackSessionIdentity,
    createStalkerEpisodePlaybackSessionKey,
    resolveStalkerEpisodeStateByIdentity,
} from './stalker-episode-playback-session-key';

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
    ])(
        'keeps %s provider credentials out of the structural key',
        (seriesMode) => {
            const originalCmdA =
                'https://user:password@stream.example/episode.mpg?access_token=secret-a';
            const originalCmdB =
                'https://user:password@stream.example/episode.mpg?access_token=secret-b';
            const stateA = episodeState({ originalCmd: originalCmdA });
            const stateB = episodeState({ originalCmd: originalCmdB });
            const composite = JSON.stringify([
                seriesMode,
                'parent|series',
                stateA.seasonKey,
                stateA.seasonNumber,
                stateA.episodeNumber,
            ]);

            const keyA = createStalkerEpisodePlaybackSessionKey({
                sourceId: 'playlist|source',
                parentSeriesId: 'parent|series',
                seriesMode,
                episodeState: stateA,
            });
            const keyB = createStalkerEpisodePlaybackSessionKey({
                sourceId: 'playlist|source',
                parentSeriesId: 'parent|series',
                seriesMode,
                episodeState: stateB,
            });

            expect(keyA).toBe(
                createPlaybackSessionKey({
                    kind: 'episode',
                    sourceId: 'playlist|source',
                    contentId: composite,
                    seriesId: 'parent|series',
                    seasonNumber: 1,
                    episodeNumber: 2,
                })
            );
            expect(keyB).toBe(keyA);
            expect(keyA).not.toContain(originalCmdA);
            expect(keyA).not.toContain('password');
            expect(keyA).not.toContain('secret-a');
        }
    );

    it('retains the exact pending guard without a synthesized tracking hash', () => {
        const originalCmd =
            'https://stream.example.invalid/episode.mpg?access_token=example-token';
        const state = episodeState({
            id: 'command-derived-tracking-hash',
            originalCmd,
        });
        const identity = captureStalkerEpisodePlaybackSessionIdentity({
            sourceId: 'playlist',
            parentSeriesId: 'series',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            episodeState: state,
        });
        if (!identity) throw new Error('Expected a captured request identity');

        expect(identity).toEqual({
            sourceId: 'playlist',
            parentSeriesId: 'series',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            originalEpisodeIdentity: originalCmd,
            seasonKey: state.seasonKey,
            seasonNumber: state.seasonNumber,
            episodeNumber: state.episodeNumber,
            sessionKey: identity.sessionKey,
        });
    });

    it('keeps lazy provider ids transient while rejecting an id refresh for a pending request', () => {
        const stateA = episodeState({ originalId: 'provider|episode:token-a' });
        const stateB = episodeState({ originalId: 'provider|episode:token-b' });
        const options = {
            sourceId: 'playlist',
            parentSeriesId: '50001',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.LazyVod,
        } as const;
        const identityA = captureStalkerEpisodePlaybackSessionIdentity({
            ...options,
            episodeState: stateA,
        });
        const keyB = createStalkerEpisodePlaybackSessionKey({
            ...options,
            episodeState: stateB,
        });
        if (!identityA) throw new Error('Expected a captured request identity');

        expect(identityA.originalEpisodeIdentity).toBe(
            'provider|episode:token-a'
        );
        expect(keyB).toBe(identityA.sessionKey);
        expect(keyB).not.toContain('provider|episode:token-a');
        expect(keyB).not.toContain('provider|episode:token-b');
        expect(keyB).not.toContain('synthesized-32-bit-id');
        expect(
            resolveStalkerEpisodeStateByIdentity({
                episodesBySeason: { [stateB.seasonKey]: [stateB.episode] },
                identity: identityA,
            })
        ).toBeNull();
    });

    it('separates every structural coordinate without delimiter collisions', () => {
        const base = {
            sourceId: 'playlist|a',
            parentSeriesId: 'parent|a',
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            episodeState: episodeState({ originalCmd: 'cmd|a' }),
        } as const;
        const variants = [
            { ...base, sourceId: 'playlist|b' },
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
            {
                ...base,
                episodeState: {
                    ...base.episodeState,
                    seasonNumber: 2,
                },
            },
            {
                ...base,
                episodeState: {
                    ...base.episodeState,
                    episodeNumber: 3,
                },
            },
        ];
        const baseKey = createStalkerEpisodePlaybackSessionKey(base);
        const delimiterVariantKey = createStalkerEpisodePlaybackSessionKey({
            ...base,
            sourceId: 'playlist',
            parentSeriesId: 'a|parent|a',
        });

        expect(
            variants.map(createStalkerEpisodePlaybackSessionKey)
        ).not.toContain(baseKey);
        expect(delimiterVariantKey).not.toBe(baseKey);
    });

    it.each([
        {
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            state: episodeState({}),
        },
        {
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.RegularSeries,
            state: episodeState({ originalCmd: '' }),
        },
        {
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.LazyVod,
            state: episodeState({}),
        },
        {
            seriesMode: STALKER_SERIES_DOWNLOAD_MODES.LazyVod,
            state: episodeState({ originalId: '' }),
        },
    ])(
        'fails closed when original episode identity is absent',
        ({ seriesMode, state }) => {
            expect(
                createStalkerEpisodePlaybackSessionKey({
                    sourceId: 'playlist',
                    parentSeriesId: 'series',
                    seriesMode,
                    episodeState: state,
                })
            ).toBe('');
        }
    );
});
