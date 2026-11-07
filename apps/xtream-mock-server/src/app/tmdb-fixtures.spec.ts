import {
    buildMarketingPortalFixture,
    buildMarketingVodDetails,
} from './generators/marketing.generator';
import { createXtreamMockApp } from './server';
import { startLoopbackServer } from './testing/http-server.fixture';

jest.mock('@faker-js/faker', () => ({ faker: {} }));

describe('fictional TMDB fixture', () => {
    let server: Awaited<ReturnType<typeof startLoopbackServer>>;
    const catalog = buildMarketingPortalFixture();
    const movie = catalog.vodStreams[0];

    beforeEach(async () => {
        server = await startLoopbackServer(
            createXtreamMockApp({ host: '127.0.0.1', port: 0 })
        );
    });
    afterEach(async () => server.close());

    async function json(path: string) {
        const response = await fetch(`${server.origin}/tmdb/3${path}`);
        expect(response.status).toBe(200);
        return response.json();
    }

    it('serves matching movie metadata and refuses unknown titles and IDs', async () => {
        const details = await json(`/movie/${movie.stream_id}`);
        const provider = buildMarketingVodDetails(movie).info;
        if (Array.isArray(provider)) throw new Error('Missing marketing movie');
        expect(details.title).toBe(movie.name);
        expect(details.genres[0].name).toBe(provider.genre);
        expect(details.runtime).toBe(Number(provider.duration_secs) / 60);
        expect(details.vote_average).toBe(provider.rating);
        expect(details.production_countries[0].name).toBe('Meridian Union');
        expect(
            details.credits.cast.map((person: { name: string }) => person.name)
        ).toEqual(String(provider.actors).split(', '));
        expect(details.credits.crew[0].name).toBe(provider.director);
        const query = await json(
            `/search/movie?query=${encodeURIComponent(movie.name)}`
        );
        expect(query.results[0].id).toBe(movie.stream_id);
        expect(
            (await json('/search/movie?query=Unknown%20fixture')).results
        ).toEqual([]);
        expect(
            (await fetch(`${server.origin}/tmdb/3/movie/999999999`)).status
        ).toBe(404);
    });

    it('serves series metadata and individual season episodes', async () => {
        const search = await json('/search/tv?query=Skyline%20Sentinels');
        const series = await json(`/tv/${search.results[0].id}`);
        expect(series.name).toBe('Skyline Sentinels');
        expect(series.episode_run_time).toEqual([44]);
        expect(series.created_by[0].name).toBeTruthy();
        expect(series.credits.crew).toEqual([]);
        const creator = await json(`/person/${series.created_by[0].id}`);
        expect(creator.combined_credits.crew).toContainEqual(
            expect.objectContaining({ id: series.id, job: 'Creator' })
        );
        const season = await json(`/tv/${series.id}/season/1`);
        expect(season.episodes).toHaveLength(6);
        expect(season.episodes[0].name).toBe('The Dawn Shift');
        expect(season.episodes[0].still_path).toContain('episode/');
        expect(
            (await fetch(`${server.origin}/tmdb/3/tv/${series.id}/season/99`))
                .status
        ).toBe(404);
        expect(
            (
                await fetch(
                    `${server.origin}/tmdb/3/tv/${series.id}/season/toString`
                )
            ).status
        ).toBe(404);
    });

    it('serves fictional filmographies and local portrait/poster/backdrop images', async () => {
        const movieDetails = await json(`/movie/${movie.stream_id}`);
        const actor = movieDetails.credits.cast[0];
        const person = await json(`/person/${actor.id}`);
        expect(person.name).toBe(actor.name);
        expect(person.combined_credits.cast).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: movie.stream_id }),
            ])
        );
        for (const path of [
            actor.profile_path,
            movieDetails.poster_path,
            movieDetails.backdrop_path,
        ]) {
            const response = await fetch(
                `${server.origin}/tmdb/t/p/w500${path}`
            );
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toMatch(/^image\//);
            expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(
                100
            );
        }
    });

    it('does not enable the demo API in performance control mode', async () => {
        const performance = await startLoopbackServer(
            createXtreamMockApp({
                host: '127.0.0.1',
                port: 0,
                control: { enabled: true, token: 'synthetic-control-token' },
            })
        );
        try {
            expect(
                (await fetch(`${performance.origin}/tmdb/3/configuration`))
                    .status
            ).toBe(404);
        } finally {
            await performance.close();
        }
    });
});
