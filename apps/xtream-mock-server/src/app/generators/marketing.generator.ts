import {
    MARKETING_LIVE_CATEGORIES,
    MARKETING_LIVE_CHANNELS,
    MarketingLiveCategoryKey,
    MarketingLiveChannelFixture,
    MarketingMovieCategoryKey,
    MarketingMovieFixture,
    POSTER_SHOWCASE_MOVIES as SHARED_POSTER_SHOWCASE_MOVIES,
    escapeMarketingSvg,
    marketingHash,
    marketingPalette,
    marketingSlug,
    marketingSvgDocument,
    marketingTitleFromSlug,
    renderMarketingLogoSvg,
} from '@iptvnator/shared/marketing-fixtures';
import { RawCategory } from './categories.generator.js';
import {
    buildEpgListing,
    RawEpgListing,
    RawLiveStream,
} from './live.generator.js';
import { RawSeriesInfo, RawSeriesItem } from './series.generator.js';
import { RawVodDetails, RawVodStream } from './vod.generator.js';

type MarketingAssetKind = 'backdrop' | 'episode' | 'logo' | 'poster' | 'season';

type MarketingMovie = {
    actors: string;
    categoryId: string;
    description: string;
    director: string;
    genre: string;
    name: string;
    rating: number;
    tagline: string;
    year: number;
};

type MarketingSeries = {
    actors: string;
    categoryId: string;
    description: string;
    director: string;
    genre: string;
    name: string;
    rating: number;
    tagline: string;
    year: number;
};

export type MarketingArtworkFixture = {
    contentType: 'movie' | 'series';
    description: string;
    genre: string;
    name: string;
    slug: string;
    tagline: string;
    year: number;
};

export type MarketingPortalFixture = {
    liveCategories: RawCategory[];
    liveStreams: RawLiveStream[];
    vodCategories: RawCategory[];
    vodStreams: RawVodStream[];
    seriesCategories: RawCategory[];
    seriesItems: RawSeriesItem[];
    epgListingsByStreamId: Map<number, RawEpgListing[]>;
};

const MARKETING_LIVE_STREAM_ID_BASE = 52_000;
const MARKETING_VOD_STREAM_ID_BASE = 62_000;
const MARKETING_SERIES_ID_BASE = 72_000;
const MARKETING_EPISODE_ID_BASE = 82_000;
const ADDED_BASE = 1_777_000_000;

const XTREAM_LIVE_CATEGORY_IDS: Record<MarketingLiveCategoryKey, string> = {
    newsroom: '5101',
    sports: '5102',
    family: '5103',
    culture: '5104',
};

const LIVE_CATEGORIES: RawCategory[] = MARKETING_LIVE_CATEGORIES.map(
    (category) => ({
        category_id: XTREAM_LIVE_CATEGORY_IDS[category.key],
        category_name: category.name,
        parent_id: 0,
    })
);

const VOD_CATEGORIES: RawCategory[] = [
    { category_id: '5201', category_name: 'Action & Mystery', parent_id: 0 },
    {
        category_id: '5202',
        category_name: 'Cosmic & Future Worlds',
        parent_id: 0,
    },
    { category_id: '5203', category_name: 'Family Animation', parent_id: 0 },
    { category_id: '5204', category_name: 'Documentary & Drama', parent_id: 0 },
];

const XTREAM_VOD_CATEGORY_IDS: Record<MarketingMovieCategoryKey, string> = {
    'action-mystery': '5201',
    'future-fantasy': '5202',
    'family-comedy': '5203',
    'drama-documentary': '5204',
};

function toMarketingMovie(movie: MarketingMovieFixture): MarketingMovie {
    return {
        actors: movie.actors,
        categoryId: XTREAM_VOD_CATEGORY_IDS[movie.categoryKey],
        description: movie.description,
        director: movie.director,
        genre: movie.genre,
        name: movie.name,
        rating: movie.rating,
        tagline: movie.tagline,
        year: movie.year,
    };
}

const SERIES_CATEGORIES: RawCategory[] = [
    { category_id: '5301', category_name: 'Urban Drama', parent_id: 0 },
    { category_id: '5302', category_name: 'Speculative Series', parent_id: 0 },
    { category_id: '5303', category_name: 'Noir & Neon', parent_id: 0 },
    { category_id: '5304', category_name: 'Creative Docs', parent_id: 0 },
];

const LIVE_CHANNELS: readonly MarketingLiveChannelFixture[] =
    MARKETING_LIVE_CHANNELS;

const GENERATED_ARTWORK_MOVIES: MarketingMovie[] = [
    {
        categoryId: '5201',
        name: 'Crimson Skylark',
        description:
            'A high-altitude rescue courier follows sunrise signals through the storm routes above Meridian City.',
        director: 'Ari Vale',
        actors: 'Mara Sol, Theo Quill, Iris Vale, Nico Reed',
        genre: 'Aerial Rescue Adventure',
        rating: 8.5,
        tagline: 'Every sunrise needs a signal.',
        year: 2026,
    },
    {
        categoryId: '5201',
        name: 'The Voltage Guard',
        description:
            'Four transit workers race to keep the night trains moving as a thunderstorm turns the city grid unstable.',
        director: 'Noah Kade',
        actors: 'Lena Voss, Mateo Rinn, Cora Vale, Juno Pike',
        genre: 'Disaster Action Thriller',
        rating: 8.1,
        tagline: 'Power is only heroic when it is shared.',
        year: 2025,
    },
    {
        categoryId: '5201',
        name: 'Midnight Mantle',
        description:
            'A retired stage magician investigates a living cloak rumor haunting the old theatre district after dark.',
        director: 'Selene Park',
        actors: 'Iris Vale, Bram Cole, Tessa Moon, Rafi North',
        genre: 'Gothic Mystery',
        rating: 8.0,
        tagline: 'The city has one last trick.',
        year: 2024,
    },
    {
        categoryId: '5202',
        name: 'Quantum Comet',
        description:
            'An orbital cartographer rides a fractured comet trail to stop a time-lost armada.',
        director: 'Vera Lin',
        actors: 'Kai Mercer, Lina Storm, Ren Sato, Nova Bell',
        genre: 'Cosmic Science Fiction',
        rating: 8.7,
        tagline: 'Faster than tomorrow.',
        year: 2026,
    },
    {
        categoryId: '5202',
        name: 'Orbit of Atlas',
        description:
            'A rescue pilot navigates a fractured moon orbit long enough for a remote colony to evacuate.',
        director: 'Noah Kade',
        actors: 'Theo Quill, Mira Stone, Pax Arden, Elle Fenn',
        genre: 'Cosmic Survival Adventure',
        rating: 7.9,
        tagline: 'Hold the sky.',
        year: 2025,
    },
    {
        categoryId: '5202',
        name: 'Nova Relay',
        description:
            'Twin signal runners cross a star bridge to deliver the last warning before a solar network goes dark.',
        director: 'Ari Vale',
        actors: 'Cora Vale, Juno Pike, Bram Cole, Kai Mercer',
        genre: 'Space Opera',
        rating: 8.2,
        tagline: 'The message arrives in light.',
        year: 2023,
    },
    {
        categoryId: '5203',
        name: 'Beacon Boy and the Clockwork Garden',
        description:
            'A young inventor and his grandmother awaken a garden of mechanical guardians beneath the city park.',
        director: 'Selene Park',
        actors: 'Milo Grey, Anika Fern, Tessa Moon, Rafi North',
        genre: 'Animated Family Fantasy',
        rating: 8.3,
        tagline: 'Small heroes grow tall.',
        year: 2026,
    },
    {
        categoryId: '5203',
        name: 'The Invisible Saturday',
        description:
            'Two siblings learn to turn invisible every Saturday and use the gift to save their neighborhood fair.',
        director: 'Mira Stone',
        actors: 'Pax Arden, Elle Fenn, Milo Grey, Lina Storm',
        genre: 'Family, Adventure',
        rating: 7.8,
        tagline: 'Seen or unseen, courage counts.',
        year: 2024,
    },
    {
        categoryId: '5203',
        name: 'Captain Kindling',
        description:
            'A camp counselor with ember-bright powers teaches a team of misfits how to protect a forest town.',
        director: 'Vera Lin',
        actors: 'Nico Reed, Anika Fern, Theo Quill, Cora Vale',
        genre: 'Animated Family Comedy',
        rating: 7.5,
        tagline: 'A spark can lead the way.',
        year: 2022,
    },
    {
        categoryId: '5203',
        name: 'Paper Moon Parade',
        description:
            'A paper-cut moon rolls through a tiny town and invites every shy child to join a midnight parade.',
        director: 'Iris Vale',
        actors: 'Milo Grey, Anika Fern, Nova Bell, Elle Fenn',
        genre: 'Flat Kids Fantasy',
        rating: 8.1,
        tagline: 'Fold the night into wonder.',
        year: 2026,
    },
    {
        categoryId: '5203',
        name: 'Dot and the Cloud Train',
        description:
            'A small dot boards a soft cloud train and learns the colors of weather with a group of round little friends.',
        director: 'Mira Stone',
        actors: 'Pax Arden, Elle Fenn, Milo Grey, Lina Storm',
        genre: 'Preschool Cartoon Adventure',
        rating: 7.9,
        tagline: 'Every stop is a color.',
        year: 2025,
    },
    {
        categoryId: '5203',
        name: 'Tiny Planet Picnic',
        description:
            'Three children prepare a picnic on a pocket-sized planet where flowers orbit like friendly satellites.',
        director: 'Selene Park',
        actors: 'Anika Fern, Milo Grey, Tessa Moon, Pax Arden',
        genre: 'Simple Family Sci-Fi Cartoon',
        rating: 8.0,
        tagline: 'Pack a lunch for the stars.',
        year: 2024,
    },
    {
        categoryId: '5204',
        name: 'Masks of Tomorrow',
        description:
            'A fictional documentary profile of costume makers, signal engineers, and citizens building a city festival from scratch.',
        director: 'Juno Pike',
        actors: 'Mara Sol, Ren Sato, Iris Vale, Mateo Rinn',
        genre: 'Creative Documentary',
        rating: 8.4,
        tagline: 'Behind every emblem is a city.',
        year: 2025,
    },
    {
        categoryId: '5204',
        name: 'Signal Tower Seven',
        description:
            'A retro-styled chronicle of radio operators who coordinate mountain rescues during a record winter blackout.',
        director: 'Rafi North',
        actors: 'Lena Voss, Kai Mercer, Tessa Moon, Bram Cole',
        genre: 'Retro Rescue Drama',
        rating: 8.2,
        tagline: 'Not all heroes fly.',
        year: 2023,
    },
    {
        categoryId: '5204',
        name: 'The League of Lanterns',
        description:
            'A narrated archive of a volunteer lantern network that lights safe paths during impossible blackouts.',
        director: 'Mira Stone',
        actors: 'Nova Bell, Milo Grey, Elle Fenn, Ren Sato',
        genre: 'Human Interest Documentary',
        rating: 7.7,
        tagline: 'When the grid fails, people glow.',
        year: 2024,
    },
    {
        categoryId: '5204',
        name: 'The Quiet Aquarium',
        description:
            'An abstract night watch follows drifting shapes, quiet visitors, and glowing tanks inside a closed city aquarium.',
        director: 'Vera Lin',
        actors: 'Nova Bell, Ren Sato, Cora Vale, Kai Mercer',
        genre: 'Abstract Meditative Drama',
        rating: 8.3,
        tagline: 'Silence has currents.',
        year: 2026,
    },
    {
        categoryId: '5204',
        name: 'Square City Sonata',
        description:
            'Blocks, windows, crosswalks, and streetlights become a geometric city symphony over one bright afternoon.',
        director: 'Rafi North',
        actors: 'Lena Voss, Theo Quill, Mira Stone, Bram Cole',
        genre: 'Abstract Musical',
        rating: 7.6,
        tagline: 'Every corner keeps time.',
        year: 2023,
    },
    {
        categoryId: '5204',
        name: 'Lanterns Under Snow',
        description:
            'A minimalist winter tale about neighbors carrying warm paper lanterns across a silent hill town.',
        director: 'Noah Kade',
        actors: 'Milo Grey, Nova Bell, Lena Voss, Rafi North',
        genre: 'Minimalist Folk Tale',
        rating: 8.2,
        tagline: 'Small lights travel far.',
        year: 2022,
    },
];

const POSTER_SHOWCASE_MOVIES: MarketingMovie[] =
    SHARED_POSTER_SHOWCASE_MOVIES.map(toMarketingMovie);

const MOVIES: MarketingMovie[] = [
    ...POSTER_SHOWCASE_MOVIES,
    ...GENERATED_ARTWORK_MOVIES,
];

const SERIES: MarketingSeries[] = [
    {
        categoryId: '5301',
        name: 'Skyline Sentinels',
        description:
            'A young maintenance crew patrols the rooftops, rails, and river bridges of Meridian City.',
        director: 'Ari Vale',
        actors: 'Mara Sol, Theo Quill, Juno Pike, Ren Sato',
        genre: 'Urban Ensemble Drama',
        rating: 8.5,
        tagline: 'The city looks up.',
        year: 2025,
    },
    {
        categoryId: '5301',
        name: 'The Aegis Club',
        description:
            'Retired public servants reopen an old social club and mentor the next generation between neighborhood emergencies.',
        director: 'Selene Park',
        actors: 'Iris Vale, Bram Cole, Lina Storm, Mateo Rinn',
        genre: 'Workplace Dramedy',
        rating: 8.1,
        tagline: 'Legacy is a living room.',
        year: 2024,
    },
    {
        categoryId: '5302',
        name: 'Starfall Academy',
        description:
            'Cadets with unruly science experiments learn rescue work on a school ship near the asteroid belt.',
        director: 'Vera Lin',
        actors: 'Kai Mercer, Nova Bell, Cora Vale, Pax Arden',
        genre: 'Animated Space School',
        rating: 8.8,
        tagline: 'Homework can save a planet.',
        year: 2026,
    },
    {
        categoryId: '5302',
        name: 'Tomorrow Bureau',
        description:
            'Analysts with one-day foresight prevent disasters while trying not to rewrite their own lives.',
        director: 'Noah Kade',
        actors: 'Lena Voss, Theo Quill, Mira Stone, Rafi North',
        genre: 'Science Fiction, Thriller',
        rating: 8.2,
        tagline: 'The future files first.',
        year: 2025,
    },
    {
        categoryId: '5303',
        name: 'Alley Mask',
        description:
            'A bike courier investigates strange coded signals appearing in the city alleys.',
        director: 'Mira Stone',
        actors: 'Nico Reed, Anika Fern, Iris Vale, Mateo Rinn',
        genre: 'Street Noir Mystery',
        rating: 7.9,
        tagline: 'Every shortcut has a secret.',
        year: 2023,
    },
    {
        categoryId: '5303',
        name: 'Neon Sparrow',
        description:
            'A rooftop messenger follows glowing clues that only appear after midnight rain.',
        director: 'Rafi North',
        actors: 'Elle Fenn, Bram Cole, Cora Vale, Juno Pike',
        genre: 'Cyberpunk Mystery',
        rating: 7.8,
        tagline: 'Small wings, bright city.',
        year: 2024,
    },
    {
        categoryId: '5304',
        name: 'Cape Makers',
        description:
            'A fictional behind-the-scenes series about the tailors, engineers, and artists who design stage gear.',
        director: 'Juno Pike',
        actors: 'Mara Sol, Tessa Moon, Pax Arden, Ren Sato',
        genre: 'Mockumentary, Design',
        rating: 8.4,
        tagline: 'Every symbol is handmade.',
        year: 2024,
    },
    {
        categoryId: '5304',
        name: 'Citizens of the Beacon',
        description:
            'Ordinary residents tell the stories behind a citywide rescue network built after the first beacon lit.',
        director: 'Noah Kade',
        actors: 'Milo Grey, Nova Bell, Lena Voss, Rafi North',
        genre: 'Mockumentary, Human Interest',
        rating: 8.0,
        tagline: 'A city can be a hero too.',
        year: 2022,
    },
    {
        categoryId: '5304',
        name: 'Bubble Street Workshop',
        description:
            'Neighbors build simple inventions from circles, paper, and string in a cheerful street workshop.',
        director: 'Iris Vale',
        actors: 'Anika Fern, Milo Grey, Pax Arden, Elle Fenn',
        genre: 'Flat Kids Craft Cartoon',
        rating: 7.9,
        tagline: 'Round ideas roll further.',
        year: 2026,
    },
    {
        categoryId: '5303',
        name: 'Flatland Detectives',
        description:
            'Two geometric detectives solve gentle neighborhood mysteries using maps, shadows, and shape clues.',
        director: 'Mira Stone',
        actors: 'Nico Reed, Cora Vale, Juno Pike, Bram Cole',
        genre: 'Geometric Mystery Comedy',
        rating: 7.7,
        tagline: 'Every clue has a shape.',
        year: 2025,
    },
    {
        categoryId: '5302',
        name: 'Color Orchard',
        description:
            'A preschool orchard changes color each morning while tiny caretakers learn seasons, sharing, and sound.',
        director: 'Selene Park',
        actors: 'Milo Grey, Nova Bell, Tessa Moon, Elle Fenn',
        genre: 'Preschool Nature Cartoon',
        rating: 8.1,
        tagline: 'Pick a color, grow a song.',
        year: 2024,
    },
    {
        categoryId: '5302',
        name: 'Museum of Little Robots',
        description:
            'Small helpful robots wake up after closing time to arrange exhibits in a quiet retro-future museum.',
        director: 'Vera Lin',
        actors: 'Kai Mercer, Lina Storm, Ren Sato, Nova Bell',
        genre: 'Flat Retro-Future Cartoon',
        rating: 8.0,
        tagline: 'Tiny gears, big curiosity.',
        year: 2025,
    },
];

export function buildMarketingPortalFixture(): MarketingPortalFixture {
    const liveStreams = LIVE_CHANNELS.map((channel, index) =>
        buildMarketingLiveStream(channel, index)
    );
    const vodStreams = MOVIES.map((movie, index) =>
        buildMarketingVodStream(movie, index)
    );
    const seriesItems = SERIES.map((series, index) =>
        buildMarketingSeriesItem(series, index)
    );
    const epgListingsByStreamId = new Map<number, RawEpgListing[]>();

    liveStreams.forEach((stream, index) => {
        epgListingsByStreamId.set(
            stream.stream_id,
            buildMarketingEpgListings(stream, LIVE_CHANNELS[index].epgTitles)
        );
    });

    return {
        liveCategories: LIVE_CATEGORIES,
        liveStreams,
        vodCategories: VOD_CATEGORIES,
        vodStreams,
        seriesCategories: SERIES_CATEGORIES,
        seriesItems,
        epgListingsByStreamId,
    };
}

export function listMarketingArtworkFixtures(): MarketingArtworkFixture[] {
    return [
        ...GENERATED_ARTWORK_MOVIES.map((movie) => ({
            contentType: 'movie' as const,
            description: movie.description,
            genre: movie.genre,
            name: movie.name,
            slug: marketingSlug(movie.name),
            tagline: movie.tagline,
            year: movie.year,
        })),
        ...SERIES.map((series) => ({
            contentType: 'series' as const,
            description: series.description,
            genre: series.genre,
            name: series.name,
            slug: marketingSlug(series.name),
            tagline: series.tagline,
            year: series.year,
        })),
    ];
}

export function buildMarketingVodDetails(stream: RawVodStream): RawVodDetails {
    const movie = MOVIES.find((item) => item.name === stream.name) ?? MOVIES[0];
    const durationSecs = 6_840 + (stream.stream_id % 5) * 600;
    const hours = Math.floor(durationSecs / 3600);
    const minutes = Math.floor((durationSecs % 3600) / 60);

    return {
        info: {
            kinopoisk_url: '',
            tmdb_id: stream.stream_id,
            name: movie.name,
            o_name: movie.name,
            cover_big: marketingAssetUrl('poster', movie.name, '500x750'),
            movie_image: marketingAssetUrl('poster', movie.name, '300x450'),
            releasedate: `${movie.year}-04-18`,
            episode_run_time: durationSecs,
            youtube_trailer: '',
            director: movie.director,
            actors: movie.actors,
            cast: movie.actors,
            description: `${movie.tagline} ${movie.description}`,
            plot: `${movie.tagline} ${movie.description}`,
            age: '12',
            mpaa_rating: 'PG-13',
            rating_count_kinopoisk: 12_400 + stream.stream_id,
            country: 'Meridian Union',
            genre: movie.genre,
            backdrop_path: [
                marketingAssetUrl('backdrop', movie.name, '1280x720'),
            ],
            duration_secs: durationSecs,
            duration: `${hours}h ${minutes}min`,
            video: ['H.264'],
            audio: ['AAC'],
            bitrate: 4_200 + (stream.stream_id % 6) * 400,
            rating: movie.rating,
            rating_kinopoisk: movie.rating.toFixed(1),
            rating_imdb: movie.rating.toFixed(1),
        },
        movie_data: {
            stream_id: stream.stream_id,
            name: movie.name,
            added: stream.added,
            category_id: stream.category_id,
            container_extension: stream.container_extension,
            custom_sid: '',
            direct_source: '',
        },
    };
}

export function buildMarketingSeriesInfo(
    series: RawSeriesItem,
    seasonCount: number,
    episodesPerSeason: number
): RawSeriesInfo {
    const seriesFixture =
        SERIES.find((item) => item.name === series.name) ?? SERIES[0];
    const seasons = Array.from({ length: seasonCount }, (_, seasonIndex) => {
        const seasonNumber = seasonIndex + 1;
        return {
            air_date: `${seriesFixture.year + seasonIndex}-09-01`,
            episode_count: episodesPerSeason,
            id: series.series_id * 100 + seasonNumber,
            name: `Season ${seasonNumber}`,
            overview: `Season ${seasonNumber} expands ${seriesFixture.name} with new heroic alliances, brighter emblems, and city-scale rescues.`,
            season_number: seasonNumber,
            cover: marketingAssetUrl(
                'season',
                `${seriesFixture.name} Season ${seasonNumber}`,
                '300x450'
            ),
            cover_big: marketingAssetUrl(
                'season',
                `${seriesFixture.name} Season ${seasonNumber}`,
                '500x750'
            ),
        };
    });
    const episodes: RawSeriesInfo['episodes'] = {};

    seasons.forEach((season) => {
        episodes[String(season.season_number)] = Array.from(
            { length: episodesPerSeason },
            (_, episodeIndex) => {
                const episodeNumber = episodeIndex + 1;
                const episodeId =
                    MARKETING_EPISODE_ID_BASE +
                    (series.series_id - MARKETING_SERIES_ID_BASE) * 100 +
                    season.season_number * 10 +
                    episodeNumber;
                return {
                    id: String(episodeId),
                    episode_num: episodeNumber,
                    title: `${seriesFixture.name} S${season.season_number}E${episodeNumber}`,
                    container_extension: 'mkv',
                    info: {
                        tmdb_id: episodeId,
                        releasedate: `${seriesFixture.year + season.season_number - 1}-10-${String(
                            episodeNumber
                        ).padStart(2, '0')}`,
                        plot: `A new emblem appears over the skyline while the team follows a rescue signal hidden in plain sight.`,
                        duration_secs: 2_640,
                        duration: '44min',
                        movie_image: marketingAssetUrl(
                            'episode',
                            `${seriesFixture.name} Episode ${episodeNumber}`,
                            '600x338'
                        ),
                        bitrate: 4_400,
                        rating: Number(
                            Math.min(
                                9.2,
                                seriesFixture.rating + episodeNumber / 20
                            ).toFixed(1)
                        ),
                    },
                    custom_sid: '',
                    added: String(ADDED_BASE - episodeId),
                    season: season.season_number,
                    direct_source: '',
                };
            }
        );
    });

    return {
        seasons,
        episodes,
        info: {
            name: seriesFixture.name,
            cover: series.cover,
            plot: `${seriesFixture.tagline} ${seriesFixture.description}`,
            cast: seriesFixture.actors,
            director: seriesFixture.director,
            genre: seriesFixture.genre,
            releaseDate: `${seriesFixture.year}-09-01`,
            last_modified: '2026-04-20',
            rating: seriesFixture.rating.toFixed(1),
            rating_5based: Number((seriesFixture.rating / 2).toFixed(1)),
            backdrop_path: [
                marketingAssetUrl('backdrop', seriesFixture.name, '1280x720'),
            ],
            youtube_trailer: '',
            episode_run_time: '44',
            category_id: String(series.category_id),
        },
    };
}

export function marketingAssetUrl(
    kind: MarketingAssetKind,
    title: string,
    size: string
): string {
    return `${marketingAssetOrigin()}/assets/marketing/${kind}/${marketingSlug(
        title
    )}.svg?size=${encodeURIComponent(size)}`;
}

export function renderMarketingAssetSvg(
    kind: MarketingAssetKind,
    slug: string,
    size: string | undefined
): string {
    const { width, height } = parseSize(size, kind);
    const title = marketingTitleFromSlug(slug);
    const palette = marketingPalette(`${kind}:${slug}`);
    if (kind === 'logo') {
        return renderMarketingLogoSvg(slug, size);
    }

    if (kind === 'backdrop' || kind === 'episode') {
        const skylineY = height * 0.7;
        const heroX = width * (0.34 + (marketingHash(slug) % 20) / 100);
        const heroY = height * 0.38;
        const accentX = width * (0.68 + (marketingHash(`${slug}:light`) % 16) / 100);

        return marketingSvgDocument(
            width,
            height,
            `
            <defs>
                <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stop-color="${palette[0]}" />
                    <stop offset="48%" stop-color="${palette[1]}" />
                    <stop offset="100%" stop-color="${palette[2]}" />
                </linearGradient>
                <radialGradient id="flare" cx="70%" cy="28%" r="52%">
                    <stop offset="0%" stop-color="#fff4d2" stop-opacity="0.74" />
                    <stop offset="42%" stop-color="#ffffff" stop-opacity="0.22" />
                    <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
                </radialGradient>
                <radialGradient id="groundGlow" cx="42%" cy="86%" r="66%">
                    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.24" />
                    <stop offset="100%" stop-color="#000000" stop-opacity="0" />
                </radialGradient>
                <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="${Math.max(8, width * 0.015)}" />
                </filter>
            </defs>
            <rect width="100%" height="100%" fill="url(#sky)" />
            <rect width="100%" height="100%" fill="url(#flare)" />
            <rect width="100%" height="100%" fill="url(#groundGlow)" />
            <circle cx="${accentX}" cy="${height * 0.26}" r="${Math.min(width, height) * 0.18}" fill="#ffffff" opacity="0.18" filter="url(#soft)" />
            <path d="M ${width * 0.02} ${height * 0.78} C ${width * 0.22} ${height * 0.48}, ${width * 0.48} ${height * 0.92}, ${width * 0.98} ${height * 0.5}" fill="none" stroke="#ffffff" stroke-width="${Math.max(6, width * 0.012)}" stroke-linecap="round" opacity="0.18" />
            <path d="M ${width * 0.08} ${height * 0.18} L ${width * 0.96} ${height * 0.58}" stroke="#ffffff" stroke-width="${Math.max(2, width * 0.003)}" opacity="0.16" />
            <path d="M ${width * 0.92} ${height * 0.12} L ${width * 0.2} ${height * 0.66}" stroke="#ffffff" stroke-width="${Math.max(2, width * 0.003)}" opacity="0.12" />
            <path d="M ${width * 0.02} ${skylineY} L ${width * 0.02} ${height} L ${width * 0.98} ${height} L ${width * 0.98} ${skylineY + height * 0.08} L ${width * 0.9} ${skylineY + height * 0.08} L ${width * 0.9} ${skylineY - height * 0.05} L ${width * 0.8} ${skylineY - height * 0.05} L ${width * 0.8} ${skylineY + height * 0.02} L ${width * 0.7} ${skylineY + height * 0.02} L ${width * 0.7} ${skylineY - height * 0.11} L ${width * 0.6} ${skylineY - height * 0.11} L ${width * 0.6} ${skylineY + height * 0.05} L ${width * 0.5} ${skylineY + height * 0.05} L ${width * 0.5} ${skylineY - height * 0.04} L ${width * 0.39} ${skylineY - height * 0.04} L ${width * 0.39} ${skylineY + height * 0.09} L ${width * 0.28} ${skylineY + height * 0.09} L ${width * 0.28} ${skylineY - height * 0.02} L ${width * 0.18} ${skylineY - height * 0.02} L ${width * 0.18} ${skylineY + height * 0.1} L ${width * 0.08} ${skylineY + height * 0.1} L ${width * 0.08} ${skylineY - height * 0.06} Z" fill="#030712" opacity="0.68" />
            <path d="M ${heroX - width * 0.1} ${heroY + height * 0.06} C ${heroX - width * 0.3} ${heroY + height * 0.22}, ${heroX - width * 0.24} ${heroY + height * 0.46}, ${heroX + width * 0.02} ${heroY + height * 0.48} C ${heroX - width * 0.02} ${heroY + height * 0.24}, ${heroX + width * 0.02} ${heroY + height * 0.1}, ${heroX + width * 0.08} ${heroY + height * 0.02} Z" fill="#090b13" opacity="0.72" />
            <ellipse cx="${heroX}" cy="${heroY}" rx="${width * 0.035}" ry="${height * 0.065}" fill="#151722" opacity="0.9" />
            <path d="M ${heroX - width * 0.045} ${heroY + height * 0.07} L ${heroX + width * 0.052} ${heroY + height * 0.07} L ${heroX + width * 0.09} ${heroY + height * 0.36} L ${heroX - width * 0.08} ${heroY + height * 0.36} Z" fill="#0d1020" opacity="0.92" />
            <path d="M ${heroX - width * 0.02} ${heroY + height * 0.14} L ${heroX + width * 0.045} ${heroY + height * 0.14} L ${heroX + width * 0.01} ${heroY + height * 0.22} Z" fill="#ffffff" opacity="0.34" />
            <ellipse cx="${heroX + width * 0.01}" cy="${skylineY + height * 0.23}" rx="${width * 0.22}" ry="${height * 0.045}" fill="#000000" opacity="0.28" filter="url(#soft)" />
            `
        );
    }

    const titleFontSize = height * 0.07;
    const subLabel =
        kind === 'season' ? 'SEASON HERO ART' : 'FICTIONAL HERO FEATURE';
    const creditLine = creditLineFor(`${kind}:${slug}`);
    const cityY = height * 0.74;
    const titleLines = title
        .split(/\s+/)
        .reduce<string[]>((lines, word) => {
            const current = lines.at(-1) ?? '';
            if (`${current} ${word}`.trim().length > 13 && current) {
                lines.push(word);
            } else if (lines.length === 0) {
                lines.push(word);
            } else {
                lines[lines.length - 1] = `${current} ${word}`.trim();
            }
            return lines;
        }, [])
        .slice(0, 3);

    return marketingSvgDocument(
        width,
        height,
        `
        <defs>
            <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stop-color="${palette[0]}" />
                <stop offset="56%" stop-color="${palette[1]}" />
                <stop offset="100%" stop-color="${palette[2]}" />
            </linearGradient>
            <radialGradient id="light" cx="70%" cy="22%" r="68%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.38" />
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
            </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)" />
        <rect width="100%" height="100%" fill="url(#light)" />
        <polygon points="${width * 0.7},${height * 0.04} ${width * 0.78},${height * 0.32} ${width * 0.95},${height * 0.28} ${width * 0.82},${height * 0.5} ${width * 0.9},${height * 0.8} ${width * 0.66},${height * 0.54} ${width * 0.48},${height * 0.62} ${width * 0.58},${height * 0.38}" fill="#ffffff" opacity="0.18" />
        <circle cx="${width * 0.18}" cy="${height * 0.22}" r="${Math.min(width, height) * 0.22}" fill="#ffffff" opacity="0.14" />
        <circle cx="${width * 0.86}" cy="${height * 0.76}" r="${Math.min(width, height) * 0.3}" fill="#000000" opacity="0.2" />
        <path d="M ${width * -0.1} ${height * 0.78} C ${width * 0.24} ${height * 0.48}, ${width * 0.52} ${height * 0.92}, ${width * 1.1} ${height * 0.42}" fill="none" stroke="#ffffff" stroke-width="${Math.max(10, width * 0.025)}" stroke-linecap="round" opacity="0.2" />
        <path d="M ${width * 0.16} ${height * 0.28} C ${width * 0.32} ${height * 0.08}, ${width * 0.58} ${height * 0.08}, ${width * 0.76} ${height * 0.3} C ${width * 0.62} ${height * 0.44}, ${width * 0.36} ${height * 0.44}, ${width * 0.16} ${height * 0.28} Z" fill="#000000" opacity="0.24" />
        <circle cx="${width * 0.36}" cy="${height * 0.27}" r="${Math.max(8, width * 0.035)}" fill="#ffffff" opacity="0.5" />
        <circle cx="${width * 0.58}" cy="${height * 0.27}" r="${Math.max(8, width * 0.035)}" fill="#ffffff" opacity="0.5" />
        <path d="M ${width * 0.06} ${cityY} L ${width * 0.06} ${height * 0.92} L ${width * 0.96} ${height * 0.92} L ${width * 0.96} ${cityY + height * 0.08} L ${width * 0.88} ${cityY + height * 0.08} L ${width * 0.88} ${cityY - height * 0.04} L ${width * 0.78} ${cityY - height * 0.04} L ${width * 0.78} ${cityY + height * 0.03} L ${width * 0.66} ${cityY + height * 0.03} L ${width * 0.66} ${cityY - height * 0.09} L ${width * 0.55} ${cityY - height * 0.09} L ${width * 0.55} ${cityY + height * 0.05} L ${width * 0.44} ${cityY + height * 0.05} L ${width * 0.44} ${cityY - height * 0.02} L ${width * 0.32} ${cityY - height * 0.02} L ${width * 0.32} ${cityY + height * 0.07} L ${width * 0.2} ${cityY + height * 0.07} L ${width * 0.2} ${cityY - height * 0.05} Z" fill="#050812" opacity="0.58" />
        <path d="M ${width * 0.06} ${height * 0.09} L ${width * 0.94} ${height * 0.09}" stroke="#ffffff" stroke-width="2" opacity="0.28" />
        <text x="${width * 0.08}" y="${height * 0.15}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(11, height * 0.025)}" font-weight="700" letter-spacing="3" fill="#ffffff" opacity="0.76">${subLabel}</text>
        ${titleLines
            .map(
                (line, index) =>
                    `<text x="${width * 0.08}" y="${height * 0.58 + index * titleFontSize * 1.05}" font-family="Arial, Helvetica, sans-serif" font-size="${titleFontSize}" font-weight="900" fill="#ffffff">${escapeMarketingSvg(line.toUpperCase())}</text>`
            )
            .join('')}
        <text x="${width * 0.08}" y="${height * 0.84}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(11, height * 0.024)}" font-weight="800" fill="#ffffff" opacity="0.76">${escapeMarketingSvg(creditLine)}</text>
        <text x="${width * 0.08}" y="${height * 0.9}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(12, height * 0.028)}" font-weight="700" fill="#ffffff" opacity="0.72">IPTVnator fictional demo artwork</text>
        `
    );
}

function buildMarketingLiveStream(
    channel: MarketingLiveChannelFixture,
    index: number
): RawLiveStream {
    const streamId = MARKETING_LIVE_STREAM_ID_BASE + index;
    return {
        num: index + 1,
        name: channel.name,
        stream_type: 'live',
        stream_id: streamId,
        stream_icon: marketingAssetUrl('logo', channel.name, '256x256'),
        epg_channel_id: `marketing-channel-${streamId}`,
        added: String(ADDED_BASE - index * 4_000),
        category_id: XTREAM_LIVE_CATEGORY_IDS[channel.categoryKey],
        custom_sid: '',
        direct_source: '',
        tv_archive: 1,
        tv_archive_duration: 3,
        rating_imdb: (7.2 + index / 10).toFixed(1),
    };
}

function buildMarketingVodStream(
    movie: MarketingMovie,
    index: number
): RawVodStream {
    const streamId = MARKETING_VOD_STREAM_ID_BASE + index;
    return {
        num: index + 1,
        name: movie.name,
        stream_type: 'movie',
        stream_id: streamId,
        stream_icon: marketingAssetUrl('poster', movie.name, '300x450'),
        added: String(ADDED_BASE - index * 8_000),
        category_id: movie.categoryId,
        custom_sid: '',
        direct_source: '',
        rating: movie.rating,
        rating_5based: Number((movie.rating / 2).toFixed(1)),
        rating_imdb: movie.rating.toFixed(1),
        container_extension: 'mkv',
        type: 'movie',
    };
}

function buildMarketingSeriesItem(
    series: MarketingSeries,
    index: number
): RawSeriesItem {
    const seriesId = MARKETING_SERIES_ID_BASE + index;
    return {
        num: index + 1,
        name: series.name,
        series_id: seriesId,
        cover: marketingAssetUrl('poster', series.name, '300x450'),
        plot: `${series.tagline} ${series.description}`,
        cast: series.actors,
        director: series.director,
        genre: series.genre,
        releaseDate: `${series.year}-09-01`,
        last_modified: '2026-04-20',
        rating: series.rating.toFixed(1),
        rating_5based: Number((series.rating / 2).toFixed(1)),
        backdrop_path: [marketingAssetUrl('backdrop', series.name, '1280x720')],
        youtube_trailer: '',
        episode_run_time: '44',
        category_id: Number(series.categoryId),
    };
}

function buildMarketingEpgListings(
    stream: RawLiveStream,
    titles: readonly string[]
): RawEpgListing[] {
    const now = Math.floor(Date.now() / 1000);
    const slotSeconds = 30 * 60;
    const roundedNow = now - (now % slotSeconds);
    const channelId = stream.epg_channel_id;

    return Array.from({ length: 8 }, (_, index) => {
        const title = titles[index % titles.length];
        const startTimestamp = roundedNow + (index - 2) * slotSeconds;
        return buildEpgListing({
            id: `${stream.stream_id}-${index}`,
            epgId: channelId,
            title,
            description: `${title} on ${stream.name}, part of the fictional IPTVnator demo schedule.`,
            startTimestamp,
            stopTimestamp: startTimestamp + slotSeconds,
            channelId,
        });
    });
}

function marketingAssetOrigin(): string {
    const port = process.env['PORT'] ?? '3211';
    return `http://localhost:${port}`;
}

function parseSize(
    size: string | undefined,
    kind: MarketingAssetKind
): { width: number; height: number } {
    const fallback =
        kind === 'backdrop'
            ? { width: 1280, height: 720 }
            : kind === 'episode'
              ? { width: 600, height: 338 }
              : kind === 'logo'
                ? { width: 256, height: 256 }
                : { width: 300, height: 450 };
    const match = size?.match(/^(\d+)x(\d+)$/);
    if (!match) {
        return fallback;
    }
    return {
        width: Number(match[1]),
        height: Number(match[2]),
    };
}

function creditLineFor(seed: string): string {
    const credits = [
        'STARRING MARA SOL / THEO QUILL / IRIS VALE',
        'STARRING LENA VOSS / MATEO RINN / CORA VALE',
        'STARRING KAI MERCER / NOVA BELL / REN SATO',
        'STARRING ANIKA FERN / MILO GREY / PAX ARDEN',
        'STARRING NICO REED / TESSA MOON / BRAM COLE',
        'STARRING ELLE FENN / RAFI NORTH / MIRA STONE',
    ];
    return credits[marketingHash(seed) % credits.length];
}

