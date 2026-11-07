import type { Express } from 'express';
import {
    marketingHash,
    marketingPalette,
    marketingSlug,
} from '@iptvnator/shared/marketing-fixtures';
import {
    buildMarketingPortalFixture,
    buildMarketingSeriesInfo,
    buildMarketingVodDetails,
} from './generators/marketing.generator.js';

interface DemoTitle {
    id: number;
    kind: 'movie' | 'tv';
    name: string;
    date: string;
    overview: string;
    genre: string;
    duration: number;
    rating: number;
    actors: string;
    director: string;
}

function person(name: string) {
    const id = marketingHash(`demo-person:${name}`) + 1;
    return { id, name, profile_path: `/person/${id}.svg` };
}

function details(title: DemoTitle) {
    const author = person(title.director);
    return {
        id: title.id,
        media_type: title.kind,
        title: title.name,
        name: title.name,
        release_date: title.date,
        first_air_date: title.date,
        overview: title.overview,
        original_language: 'en',
        poster_path: `/poster/${marketingSlug(title.name)}.svg`,
        backdrop_path: `/backdrop/${marketingSlug(title.name)}.svg`,
        genres: [{ id: 1, name: title.genre }],
        production_countries: [{ iso_3166_1: 'XY', name: 'Meridian Union' }],
        runtime: title.duration,
        episode_run_time: [title.duration],
        vote_average: title.rating,
        vote_count: 250,
        credits: {
            cast: title.actors.split(', ').map((name, index) => ({
                ...person(name),
                character: ['Inspector', 'Dispatcher', 'Archivist', 'Pilot'][
                    index % 4
                ],
                order: index,
            })),
            crew:
                title.kind === 'movie'
                    ? [{ ...author, job: 'Director', department: 'Directing' }]
                    : [],
        },
        created_by: title.kind === 'tv' ? [author] : [],
    };
}

/** Fictional TMDB-shaped API; installed only on the normal local fixture server. */
export function installTmdbFixtures(app: Express): void {
    const catalog = buildMarketingPortalFixture();
    const titles: DemoTitle[] = [
        ...catalog.vodStreams.map((stream): DemoTitle => {
            const info = buildMarketingVodDetails(stream).info;
            if (Array.isArray(info)) throw new Error('Missing marketing movie');
            return {
                id: stream.stream_id,
                kind: 'movie',
                name: stream.name,
                date: info.releasedate,
                overview: info.plot,
                genre: info.genre,
                duration: info.duration_secs / 60,
                rating: info.rating,
                actors: info.actors,
                director: info.director,
            };
        }),
        ...catalog.seriesItems.map((series): DemoTitle => {
            const info = buildMarketingSeriesInfo(series, 3, 6).info;
            return {
                id: series.series_id,
                kind: 'tv',
                name: series.name,
                date: info.releaseDate,
                overview: info.plot,
                genre: info.genre,
                duration: Number(info.episode_run_time),
                rating: Number(info.rating),
                actors: info.cast,
                director: info.director,
            };
        }),
    ];
    const entries = titles.map(details);
    const people = new Map(
        entries
            .flatMap((entry) => [
                ...entry.credits.cast,
                ...entry.credits.crew,
                ...entry.created_by,
            ])
            .map((member) => [member.id, person(member.name)])
    );
    app.get('/tmdb/3/configuration', (_request, response) => {
        response.json({ images: { secure_base_url: '/tmdb/t/p/' } });
    });
    app.get('/tmdb/3/search/:kind', (request, response) => {
        const query = String(request.query['query'] ?? '')
            .trim()
            .toLowerCase();
        response.json({
            page: 1,
            total_pages: 1,
            results: query
                ? entries.filter(
                      (entry) =>
                          entry.media_type === request.params['kind'] &&
                          entry.title.toLowerCase() === query
                  )
                : [],
        });
    });
    app.get('/tmdb/3/tv/:id/season/:season', (request, response) => {
        const series = catalog.seriesItems.find(
            (item) => item.series_id === Number(request.params['id'])
        );
        const season = String(request.params['season']);
        const episodes =
            series && ['1', '2', '3'].includes(season)
                ? buildMarketingSeriesInfo(series, 3, 6).episodes[season]
                : undefined;
        if (!episodes) {
            response.status(404).json({ status_code: 34 });
            return;
        }
        response.json({
            episodes: episodes.map((episode) => {
                const artwork = new URL(episode.info.movie_image);
                return {
                    episode_number: episode.episode_num,
                    name: episode.title,
                    overview: episode.info.plot,
                    still_path: artwork.pathname.replace(
                        '/assets/marketing',
                        ''
                    ),
                };
            }),
        });
    });
    app.get('/tmdb/3/person/:id', (request, response) => {
        const member = people.get(Number(request.params['id']));
        if (!member) {
            response.status(404).json({ status_code: 34 });
            return;
        }
        const credit = (entry: (typeof entries)[number]) => ({
            id: entry.id,
            title: entry.title,
            name: entry.name,
            media_type: entry.media_type,
            release_date: entry.release_date,
            first_air_date: entry.first_air_date,
            poster_path: entry.poster_path,
        });
        response.json({
            ...member,
            biography: `${member.name} is a fictional performer in the IPTVnator demo catalog. All titles, roles and artwork in this profile are synthetic.`,
            combined_credits: {
                cast: entries
                    .filter((entry) =>
                        entry.credits.cast.some(
                            (actor) => actor.id === member.id
                        )
                    )
                    .map((entry) => ({
                        ...credit(entry),
                        character: entry.credits.cast.find(
                            (actor) => actor.id === member.id
                        )?.character,
                    })),
                crew: entries
                    .filter((entry) =>
                        [...entry.credits.crew, ...entry.created_by].some(
                            (author) => author.id === member.id
                        )
                    )
                    .map((entry) => ({
                        ...credit(entry),
                        job: entry.media_type === 'tv' ? 'Creator' : 'Director',
                    })),
            },
        });
    });
    app.get('/tmdb/3/:kind/:id', (request, response) => {
        const entry = entries.find(
            (item) =>
                item.media_type === request.params['kind'] &&
                item.id === Number(request.params['id'])
        );
        if (!entry) {
            response.status(404).json({ status_code: 34 });
            return;
        }
        response.json(entry);
    });
    app.get('/tmdb/t/p/:size/:kind/:slug', (request, response) => {
        const { kind, slug } = request.params;
        if (kind === 'person') {
            const member = people.get(
                Number(String(slug).replace(/\.svg$/, ''))
            );
            if (member) {
                response.type('image/svg+xml').send(portrait(member.id));
                return;
            }
        } else if (['poster', 'backdrop', 'episode'].includes(String(kind))) {
            response.redirect(
                `/assets/marketing/${kind}/${encodeURIComponent(String(slug))}`
            );
            return;
        }
        response.sendStatus(404);
    });
}

function portrait(id: number): string {
    const [background, shirt, accent] = marketingPalette(String(id));
    const skin = ['#c89979', '#a77153', '#dfb59a', '#94654c'][id % 4];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
        <rect width="300" height="450" fill="${background}"/>
        <circle cx="230" cy="120" r="170" fill="${accent}" opacity=".12"/>
        <ellipse cx="150" cy="465" rx="130" ry="180" fill="${shirt}"/>
        <path d="M120 250h60v80q-30 30-60 0" fill="${skin}"/>
        <ellipse cx="150" cy="195" rx="72" ry="95" fill="${skin}"/>
        <path d="M78 190q-25-125 77-115q88 5 67 123l-22-73q-53 25-100 3z" fill="#242526"/>
        <path d="M105 190h27m35 0h27" stroke="#37312e" stroke-width="7" stroke-linecap="round"/>
        <path d="M135 240q15 8 30 0" fill="none" stroke="#724b42" stroke-width="5" stroke-linecap="round"/>
    </svg>`;
}
