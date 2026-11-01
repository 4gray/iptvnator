import {
    buildMarketingPortalFixture,
    buildMarketingSeriesInfo,
} from './marketing.generator';

// The curated catalog never uses Faker. Avoid loading its ESM random-data
// implementation into this focused CommonJS Jest fixture suite.
jest.mock('@faker-js/faker', () => ({ faker: {} }));

describe('cinematic series fixture', () => {
    it('serves individual plots across three seasons and local stills for the opening episodes', () => {
        const series = buildMarketingPortalFixture().seriesItems.find(
            (item) => item.series_id === 72000
        );
        expect(series).toBeDefined();
        if (!series) throw new Error('Cinematic series fixture missing');
        const details = buildMarketingSeriesInfo(series, 3, 6);
        const episodes = Object.values(details.episodes).flat();
        expect(new Set(episodes.map((episode) => episode.title)).size).toBe(18);
        expect(new Set(episodes.map((episode) => episode.info.plot)).size).toBe(
            18
        );
        expect(details.episodes['1'][0].title).toBe('The Dawn Shift');
        expect(details.episodes['1'][1].title).toBe('Under the River');
        expect(details.episodes['1'][0].info.movie_image).toContain(
            '/episode/skyline-sentinels-episode-1.svg'
        );
        expect(details.episodes['1'][2].info.movie_image).toContain(
            '/backdrop/skyline-sentinels.svg'
        );
        expect(details.seasons[0].cover).toContain(
            '/poster/skyline-sentinels.svg'
        );
        expect(
            new Set(details.seasons.map((season) => season.overview)).size
        ).toBe(3);
    });
});
