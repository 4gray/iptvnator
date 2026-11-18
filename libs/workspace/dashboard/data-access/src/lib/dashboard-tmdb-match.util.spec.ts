import type { TmdbEnrichmentService } from '@iptvnator/services';
import {
    DashboardTmdbMatchItem,
    dashboardTmdbMatchIdentity,
    dashboardTmdbMatchToken,
    resolveDashboardTmdbDetails,
} from './dashboard-tmdb-match.util';

describe('dashboard TMDB match choice', () => {
    const xtreamSeries = {
        title: 'Synthetic Show',
        type: 'series',
        source: 'xtream',
        playlist_id: 'pl-1',
        xtream_id: 77,
    } as DashboardTmdbMatchItem;
    const stalkerSeries = {
        title: 'Synthetic Serial',
        type: 'series',
        source: 'stalker',
        playlist_id: 'pl-2',
        stalker_item: {
            id: ' 900 ',
            category_id: 'series',
            info: { name: 'Synthetic Serial' },
        },
    } as unknown as DashboardTmdbMatchItem;
    const stalkerEmbeddedSeries = {
        title: 'Synthetic Vclub',
        type: 'movie',
        source: 'stalker',
        playlist_id: 'pl-2',
        stalker_item: {
            id: '901',
            category_id: '7',
            series: [1, 2],
            info: { name: 'Synthetic Vclub' },
        },
    } as unknown as DashboardTmdbMatchItem;

    describe('identity, as the detail views store it', () => {
        it('uses the Xtream catalog type and series id', () => {
            expect(dashboardTmdbMatchIdentity(xtreamSeries)).toEqual({
                provider: 'xtream',
                playlistId: 'pl-1',
                mediaType: 'tv',
                itemId: '77',
            });
        });

        it('uses an episode position’s parent and skips choices for an unknown parent', () => {
            const episode = {
                ...xtreamSeries,
                xtream_id: 501,
            };
            const position = {
                contentXtreamId: 501,
                contentType: 'episode' as const,
            };

            expect(
                dashboardTmdbMatchIdentity(episode, {
                    ...position,
                    seriesXtreamId: 77,
                })
            ).toEqual(expect.objectContaining({ itemId: '77' }));
            expect(
                dashboardTmdbMatchIdentity(episode, {
                    ...position,
                    contentXtreamId: 502,
                    seriesXtreamId: 77,
                })
            ).toEqual(expect.objectContaining({ itemId: '77' }));
            expect(dashboardTmdbMatchIdentity(episode, position)).toBeNull();
        });

        it('uses the Stalker entry id, media type and catalog', () => {
            expect(dashboardTmdbMatchIdentity(stalkerSeries)).toEqual({
                provider: 'stalker',
                playlistId: 'pl-2',
                mediaType: 'tv',
                itemId: '900',
                catalog: 'series',
            });
            // An embedded-VOD series lives in the VOD catalog as a show.
            expect(dashboardTmdbMatchIdentity(stalkerEmbeddedSeries)).toEqual(
                expect.objectContaining({ mediaType: 'tv', catalog: 'vod' })
            );
        });

        it('has none for M3U, live or a row without its playlist', () => {
            expect(
                dashboardTmdbMatchIdentity({ ...xtreamSeries, source: 'm3u' })
            ).toBeNull();
            expect(
                dashboardTmdbMatchIdentity({ ...xtreamSeries, type: 'live' })
            ).toBeNull();
            expect(
                dashboardTmdbMatchIdentity({
                    ...xtreamSeries,
                    playlist_id: undefined,
                })
            ).toBeNull();
        });
    });

    describe('resolve', () => {
        let choice: unknown;
        let enrichMovie: jest.Mock;
        let enrichTv: jest.Mock;
        let enrichment: TmdbEnrichmentService;

        beforeEach(() => {
            choice = null;
            enrichMovie = jest.fn(async () => null);
            enrichTv = jest.fn(async () => ({ id: 5 }));
            enrichment = {
                enrichMovie,
                enrichTv,
                getMatches: async () => ({ read: () => choice }),
            } as unknown as TmdbEnrichmentService;
        });

        it('loads the manual match under its own media type, once', async () => {
            choice = { mode: 'manual', tmdbId: 5, title: 'Synthetic' };

            const result = await resolveDashboardTmdbDetails(
                enrichment,
                stalkerEmbeddedSeries
            );

            expect(result?.details).toEqual({ id: 5 });
            expect(enrichMovie).not.toHaveBeenCalled();
            expect(enrichTv).toHaveBeenCalledWith(
                expect.objectContaining({
                    matchIdentity: expect.objectContaining({ itemId: '901' }),
                })
            );
        });

        it('resolves to no TMDB data when the provider data was chosen', async () => {
            choice = { mode: 'provider' };

            const result = await resolveDashboardTmdbDetails(
                enrichment,
                stalkerEmbeddedSeries
            );

            expect(result).toEqual(expect.objectContaining({ details: null }));
            expect(enrichMovie).not.toHaveBeenCalled();
            expect(enrichTv).not.toHaveBeenCalled();
        });

        it('does not guess when a saved catalog choice cannot be read', async () => {
            jest.spyOn(enrichment, 'getMatches').mockResolvedValue(null);

            await expect(
                resolveDashboardTmdbDetails(enrichment, xtreamSeries)
            ).resolves.toBeNull();
            expect(enrichMovie).not.toHaveBeenCalled();
            expect(enrichTv).not.toHaveBeenCalled();
        });

        it('runs the automatic attempts without a choice', async () => {
            const result = await resolveDashboardTmdbDetails(
                enrichment,
                stalkerEmbeddedSeries
            );

            expect(result?.details).toEqual({ id: 5 });
            expect(enrichTv).toHaveBeenCalledWith(
                expect.not.objectContaining({
                    matchIdentity: expect.anything(),
                })
            );
        });
    });

    it('tokens the stored choice for cache keys', () => {
        const identity = dashboardTmdbMatchIdentity(xtreamSeries);
        const matches = (choice: unknown) =>
            ({ read: () => choice }) as unknown as Parameters<
                typeof dashboardTmdbMatchToken
            >[0];

        expect(dashboardTmdbMatchToken(null, identity)).toBe('');
        expect(
            dashboardTmdbMatchToken(
                matches({ mode: 'manual', tmdbId: 9, title: 'X' }),
                identity
            )
        ).toBe('manual:tv:9');
        expect(
            dashboardTmdbMatchToken(matches({ mode: 'provider' }), identity)
        ).toBe('provider');
    });
});
