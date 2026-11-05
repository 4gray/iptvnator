/**
 * The large-library profile of the `launch-large` journey
 * (docs/architecture/performance-journeys.md, "J1 on a large library").
 *
 * Everything here is a pure function of `LargeLibraryProfileSpec` and a row
 * index: no clock, no randomness, no network host that exists. Every URL
 * points at the loopback discard port (`127.0.0.1:1`), which refuses a
 * connection at once, so a launch on this profile makes no request that
 * depends on the machine's network. The generator
 * (`large-library-profile-generator.ts`) writes these rows through the app's
 * own schema and migration code; this module only describes them.
 */

/** Bump when the layout of the generated rows changes. */
export const LARGE_LIBRARY_PROFILE_VERSION = 1;

/** Loopback port 1 is unassigned: every connection is refused at once. */
export const LARGE_LIBRARY_ORIGIN = 'http://127.0.0.1:1';

/** The one XMLTV source, owned by the first M3U playlist. */
export const LARGE_LIBRARY_EPG_SOURCE_URL = `${LARGE_LIBRARY_ORIGIN}/epg/guide.xml`;

/** A fixed instant every timestamp is derived from; never the wall clock. */
export const LARGE_LIBRARY_EPOCH_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
const LARGE_LIBRARY_EPOCH_SECONDS = Math.floor(LARGE_LIBRARY_EPOCH_MS / 1_000);

export interface LargeLibraryProfileSpec {
    /** Xtream portals, each with a saved catalog. */
    readonly xtreamPortals: number;
    readonly stalkerPortals: number;
    /** M3U sources; the first `m3uLargePlaylists` carry the large payloads. */
    readonly m3uPlaylists: number;
    readonly m3uLargePlaylists: number;
    readonly m3uLargeChannels: number;
    readonly m3uSmallChannels: number;
    /** Categories per Xtream portal and type. */
    readonly categoriesPerPortal: {
        readonly live: number;
        readonly movies: number;
        readonly series: number;
    };
    /** Catalog rows per Xtream portal, split 20/60/20 live/movie/series. */
    readonly contentPerPortal: number;
    /** Durable favorites across the Xtream portals (live, movie and series). */
    readonly favorites: number;
    /** Xtream history rows (`recently_viewed`): live, movies and series. */
    readonly historyItems: number;
    /** Episode positions on top of the movie and series history positions. */
    readonly extraEpisodePositions: number;
    readonly epgChannels: number;
    readonly epgProgramsPerChannel: number;
}

/**
 * The default profile: 182 sources as the profile #1877 and #1883 were
 * found on (182 playlists, 132 history items), with the catalog sized for a
 * GitHub `ubuntu-latest` runner; the reasoning is in the journeys document.
 */
export const LARGE_LIBRARY_PROFILE_SPEC: LargeLibraryProfileSpec =
    Object.freeze({
        xtreamPortals: 120,
        stalkerPortals: 22,
        m3uPlaylists: 40,
        m3uLargePlaylists: 4,
        m3uLargeChannels: 30_000,
        m3uSmallChannels: 2_000,
        categoriesPerPortal: Object.freeze({
            live: 60,
            movies: 40,
            series: 30,
        }),
        contentPerPortal: 20_000,
        favorites: 300,
        historyItems: 132,
        extraEpisodePositions: 60,
        epgChannels: 1_000,
        epgProgramsPerChannel: 48,
    });

/**
 * `IPTVNATOR_LARGE_LIBRARY_CONTENT_PER_PORTAL` scales the catalog for a
 * local check; the value is part of the profile's cache key.
 */
export const LARGE_LIBRARY_CONTENT_PER_PORTAL_ENV =
    'IPTVNATOR_LARGE_LIBRARY_CONTENT_PER_PORTAL';

export function resolveLargeLibraryProfileSpec(
    env: Readonly<Record<string, string | undefined>>,
    base: LargeLibraryProfileSpec = LARGE_LIBRARY_PROFILE_SPEC
): LargeLibraryProfileSpec {
    const raw = env[LARGE_LIBRARY_CONTENT_PER_PORTAL_ENV];
    if (raw === undefined || raw === '') {
        return base;
    }
    const contentPerPortal = Number(raw);
    if (!Number.isSafeInteger(contentPerPortal) || contentPerPortal < 5) {
        throw new Error(
            `${LARGE_LIBRARY_CONTENT_PER_PORTAL_ENV} must be an integer of at least 5`
        );
    }
    return Object.freeze({ ...base, contentPerPortal });
}

/** The generator's last stdout line carries the manifest after this prefix. */
export const LARGE_LIBRARY_MANIFEST_PREFIX = 'large-library-profile-manifest:';
export const LARGE_LIBRARY_MANIFEST_FILE_NAME = 'manifest.json';

export interface LargeLibraryProfileManifest {
    readonly cacheKey: string;
    readonly counts: Readonly<Record<string, number>>;
    readonly databaseBytes: number;
    readonly electron: string;
    readonly generationMs: number;
    /** Wall-clock per table, milliseconds. */
    readonly phasesMs: Readonly<Record<string, number>>;
    readonly spec: LargeLibraryProfileSpec;
    readonly sqlite: string;
    readonly version: number;
}

export type LargeLibraryContentType = 'live' | 'movie' | 'series';
const CONTENT_TYPES: readonly LargeLibraryContentType[] = [
    'live',
    'movie',
    'series',
];
export type LargeLibraryCategoryType = 'live' | 'movies' | 'series';
const CATEGORY_TYPE: Record<LargeLibraryContentType, LargeLibraryCategoryType> =
    {
        live: 'live',
        movie: 'movies',
        series: 'series',
    };

const TITLE_WORDS = [
    'Amber',
    'Basalt',
    'Cedar',
    'Delta',
    'Ember',
    'Falcon',
    'Granite',
    'Harbor',
    'Indigo',
    'Juniper',
    'Kestrel',
    'Lantern',
    'Meridian',
    'Nova',
    'Orchid',
    'Pioneer',
    'Quartz',
    'Raven',
    'Summit',
    'Tundra',
    'Umber',
    'Velvet',
    'Willow',
    'Xenon',
    'Yarrow',
    'Zephyr',
    'Atlas',
    'Beacon',
    'Cobalt',
    'Drift',
    'Echo',
    'Fjord',
    'Glacier',
    'Horizon',
    'Island',
    'Jade',
    'Kite',
    'Lagoon',
    'Marble',
    'Nebula',
    'Oasis',
    'Prism',
    'Quill',
    'Ridge',
    'Saffron',
    'Tide',
    'Ultra',
    'Vortex',
    'Wander',
    'Yonder',
    'Zenith',
    'Arcade',
    'Bramble',
    'Canyon',
    'Dune',
    'Everest',
    'Flint',
    'Grove',
    'Hollow',
    'Ivory',
    'Jubilee',
    'Knoll',
    'Lumen',
    'Mosaic',
] as const;

/** Three index-derived words and a year: realistic trigram material. */
export function largeLibraryTitle(index: number): string {
    const words = TITLE_WORDS.length;
    const first = TITLE_WORDS[index % words];
    const second = TITLE_WORDS[Math.floor(index / words) % words];
    const third = TITLE_WORDS[Math.floor(index / (words * words)) % words];
    return `${first} ${second} ${third} (${1950 + (index % 76)})`;
}

function isoAt(offsetSeconds: number): string {
    return new Date(
        LARGE_LIBRARY_EPOCH_MS + offsetSeconds * 1_000
    ).toISOString();
}

/** `YYYY-MM-DD HH:MM:SS`, the form SQLite's `CURRENT_TIMESTAMP` writes. */
function sqliteTimestampAt(offsetSeconds: number): string {
    return isoAt(offsetSeconds)
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');
}

export type LargeLibraryPlaylistKind = 'm3u' | 'stalker' | 'xtream';

export interface LargeLibraryPlaylistRow {
    readonly id: string;
    readonly kind: LargeLibraryPlaylistKind;
    /** The row's columns, as `buildPlaylistRow` of the app would project them. */
    readonly document: Record<string, unknown>;
}

export function xtreamPlaylistId(portal: number): string {
    return `large-xtream-${String(portal).padStart(3, '0')}`;
}

export function stalkerPlaylistId(portal: number): string {
    return `large-stalker-${String(portal).padStart(3, '0')}`;
}

export function m3uPlaylistId(playlist: number): string {
    return `large-m3u-${String(playlist).padStart(3, '0')}`;
}

/**
 * `last_usage` descends with the source index, so the first Xtream portal is
 * the most recently used source and the first card of the dashboard's
 * "Recent sources" rail.
 */
function lastUsageAt(ordinal: number): string {
    return isoAt(-ordinal * 3_600);
}

export function xtreamPlaylistDocument(
    portal: number
): Record<string, unknown> {
    const id = xtreamPlaylistId(portal);
    return {
        _id: id,
        title: `Large Xtream portal ${portal + 1}`,
        serverUrl: `${LARGE_LIBRARY_ORIGIN}/portal-${portal + 1}`,
        username: `synthetic-user-${portal + 1}`,
        password: `synthetic-password-${portal + 1}`,
        importDate: isoAt(-86_400 * (portal + 1)),
        lastUsage: lastUsageAt(portal),
        autoRefresh: false,
        count: 0,
        favorites: [],
        recentlyViewed: [],
        position: portal,
    };
}

export function stalkerPlaylistDocument(
    portal: number,
    spec: LargeLibraryProfileSpec
): Record<string, unknown> {
    const id = stalkerPlaylistId(portal);
    const portalUrl = `${LARGE_LIBRARY_ORIGIN}/stalker-${portal + 1}/stalker_portal/c/`;
    const mac = `00:1A:79:00:${String(Math.floor(portal / 256)).padStart(2, '0')}:${String(portal % 256).padStart(2, '0')}`;
    const favorites = Array.from({ length: 3 }, (_, index) => ({
        id: String(1_000 + portal * 10 + index),
        name: `${largeLibraryTitle(portal * 10 + index)} stalker`,
        cmd: `ffmpeg ${LARGE_LIBRARY_ORIGIN}/stalker-${portal + 1}/ch/${index}`,
        stream_type: 'live',
        category_id: String(index + 1),
        added_at: isoAt(-7_200 * (portal + index + 1)),
    }));
    const recentlyViewed = [
        {
            id: String(2_000 + portal),
            name: `${largeLibraryTitle(5_000 + portal)} recent`,
            cmd: `ffmpeg ${LARGE_LIBRARY_ORIGIN}/stalker-${portal + 1}/ch/recent`,
            stream_type: 'live',
            category_id: '1',
            added_at: isoAt(-3_600 * (portal + 1)),
        },
    ];
    return {
        _id: id,
        title: `Large Stalker portal ${portal + 1}`,
        portalUrl,
        macAddress: mac,
        importDate: isoAt(-86_400 * (portal + 1)),
        lastUsage: lastUsageAt(spec.xtreamPortals + portal),
        autoRefresh: false,
        count: 0,
        favorites,
        recentlyViewed,
        position: spec.xtreamPortals + portal,
    };
}

export function m3uChannelCount(
    playlist: number,
    spec: LargeLibraryProfileSpec
): number {
    return playlist < spec.m3uLargePlaylists
        ? spec.m3uLargeChannels
        : spec.m3uSmallChannels;
}

/** One parsed M3U channel, with the raw block the parser keeps. */
export function m3uChannel(
    playlist: number,
    index: number
): Record<string, unknown> {
    const name = `${largeLibraryTitle(index)} ${playlist + 1}-${index + 1}`;
    const group = `Group ${String((index % 100) + 1).padStart(3, '0')}`;
    const tvgId = `large-${playlist + 1}-${index + 1}`;
    const url = `${LARGE_LIBRARY_ORIGIN}/stream/${playlist + 1}/${index + 1}`;
    return {
        id: `large-m3u-${playlist + 1}-channel-${index + 1}`,
        name,
        url,
        group: { title: group },
        tvg: {
            id: tvgId,
            name,
            url: '',
            logo: `${LARGE_LIBRARY_ORIGIN}/logo/${playlist + 1}/${index + 1}.png`,
            rec: '',
        },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: 'false',
        raw: `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${name}" group-title="${group}",${name}\n${url}`,
    };
}

export function m3uPlaylistDocument(
    playlist: number,
    spec: LargeLibraryProfileSpec
): Record<string, unknown> {
    const id = m3uPlaylistId(playlist);
    const count = m3uChannelCount(playlist, spec);
    const items = Array.from({ length: count }, (_, index) =>
        m3uChannel(playlist, index)
    );
    // Two favorite channels for every third playlist (the dashboard parses
    // the payload of each M3U source that has favorites).
    const favorites =
        playlist % 3 === 0
            ? [items[0]?.['id'], items[Math.floor(count / 2)]?.['id']]
            : [];
    const epgUrls = playlist === 0 ? [LARGE_LIBRARY_EPG_SOURCE_URL] : [];
    const recentlyViewed =
        playlist % 4 === 0
            ? [
                  {
                      source: 'm3u',
                      id: `large-m3u-recent-${playlist + 1}`,
                      url: `${LARGE_LIBRARY_ORIGIN}/stream/${playlist + 1}/1`,
                      title: `${largeLibraryTitle(0)} ${playlist + 1}-1`,
                      channel_id: items[0]?.['id'],
                      category_id: 'live',
                      added_at: isoAt(-900 * (playlist + 1)),
                  },
              ]
            : [];
    return {
        _id: id,
        title: `Large M3U list ${playlist + 1}`,
        url: `${LARGE_LIBRARY_ORIGIN}/playlist-${playlist + 1}.m3u`,
        playlist: {
            header: { attrs: {}, raw: '#EXTM3U' },
            items,
        },
        count,
        importDate: isoAt(-86_400 * (playlist + 1)),
        lastUsage: lastUsageAt(
            spec.xtreamPortals + spec.stalkerPortals + playlist
        ),
        autoRefresh: false,
        favorites,
        recentlyViewed,
        epgUrls,
        detectedEpgUrls: epgUrls,
        manualEpgUrls: [],
        disabledEpgUrls: [],
        position: spec.xtreamPortals + spec.stalkerPortals + playlist,
    };
}

/** Rows of one content type in one portal, split 20/60/20 live/movie/series. */
export function contentPerType(
    spec: LargeLibraryProfileSpec
): Record<LargeLibraryContentType, number> {
    const live = Math.floor(spec.contentPerPortal / 5);
    const series = Math.floor(spec.contentPerPortal / 5);
    return { live, movie: spec.contentPerPortal - live - series, series };
}

export interface LargeLibraryCategoryRow {
    readonly id: number;
    readonly playlistId: string;
    readonly name: string;
    readonly type: LargeLibraryCategoryType;
    readonly xtreamId: number;
}

/** Categories of one portal, ids global and sequential by portal and type. */
export function portalCategories(
    portal: number,
    spec: LargeLibraryProfileSpec
): LargeLibraryCategoryRow[] {
    const perPortal =
        spec.categoriesPerPortal.live +
        spec.categoriesPerPortal.movies +
        spec.categoriesPerPortal.series;
    const perTypeCategories: Record<LargeLibraryContentType, number> = {
        live: spec.categoriesPerPortal.live,
        movie: spec.categoriesPerPortal.movies,
        series: spec.categoriesPerPortal.series,
    };
    const rows: LargeLibraryCategoryRow[] = [];
    let offset = 0;
    for (const type of CONTENT_TYPES) {
        const count = perTypeCategories[type];
        for (let index = 0; index < count; index += 1) {
            rows.push({
                id: portal * perPortal + offset + index + 1,
                playlistId: xtreamPlaylistId(portal),
                name: `${CATEGORY_TYPE[type]} ${largeLibraryTitle(index)}`,
                type: CATEGORY_TYPE[type],
                xtreamId: offset + index + 1,
            });
        }
        offset += count;
    }
    return rows;
}

export interface LargeLibraryContentRow {
    readonly id: number;
    readonly categoryId: number;
    readonly title: string;
    readonly rating: string;
    /** Epoch seconds, as the Xtream import stores `added`. */
    readonly added: string;
    readonly xtreamId: number;
    readonly type: LargeLibraryContentType;
}

/** The content id of row `index` (0-based, in type order) of a portal. */
export function contentRowId(
    portal: number,
    typeIndex: number,
    spec: LargeLibraryProfileSpec
): number {
    return portal * spec.contentPerPortal + typeIndex + 1;
}

/** Portal-wide offset of the first row of a type, in `contentRowId` order. */
export function contentTypeOffset(
    type: LargeLibraryContentType,
    spec: LargeLibraryProfileSpec
): number {
    const perType = contentPerType(spec);
    return type === 'live'
        ? 0
        : type === 'movie'
          ? perType.live
          : perType.live + perType.movie;
}

/**
 * The catalog rows of one portal in id order: live, then movies, then
 * series, each spread round-robin over the type's categories. `xtream_id`
 * is unique per type within the portal.
 */
export function* portalContent(
    portal: number,
    spec: LargeLibraryProfileSpec
): Generator<LargeLibraryContentRow> {
    const categories = portalCategories(portal, spec);
    const perType = contentPerType(spec);
    let typeIndex = 0;
    for (const type of CONTENT_TYPES) {
        const typeCategories = categories.filter(
            (category) => category.type === CATEGORY_TYPE[type]
        );
        for (let index = 0; index < perType[type]; index += 1) {
            const category = typeCategories[index % typeCategories.length];
            if (category === undefined) {
                throw new Error(`large-library-no-category-${type}`);
            }
            const id = contentRowId(portal, typeIndex, spec);
            yield {
                id,
                categoryId: category.id,
                title: largeLibraryTitle(id),
                rating: String((id % 90) / 10),
                added: String(LARGE_LIBRARY_EPOCH_SECONDS - 86_400 * 400 + id),
                xtreamId: 100_000 + index + 1,
                type,
            };
            typeIndex += 1;
        }
    }
}

/** The row `n` of a type in a portal, as `portalContent` yields it. */
export function contentRowOf(
    portal: number,
    type: LargeLibraryContentType,
    index: number,
    spec: LargeLibraryProfileSpec
): LargeLibraryContentRow {
    const perType = contentPerType(spec);
    const wrapped = index % perType[type];
    const typeIndex = contentTypeOffset(type, spec) + wrapped;
    const categories = portalCategories(portal, spec).filter(
        (category) => category.type === CATEGORY_TYPE[type]
    );
    const category = categories[wrapped % categories.length];
    if (category === undefined) {
        throw new Error(`large-library-no-category-${type}`);
    }
    const id = contentRowId(portal, typeIndex, spec);
    return {
        id,
        categoryId: category.id,
        title: largeLibraryTitle(id),
        rating: String((id % 90) / 10),
        added: String(LARGE_LIBRARY_EPOCH_SECONDS - 86_400 * 400 + id),
        xtreamId: 100_000 + wrapped + 1,
        type,
    };
}

export interface LargeLibraryFavoriteRow {
    readonly id: number;
    readonly contentId: number;
    readonly playlistId: string;
    readonly xtreamId: number;
    readonly type: LargeLibraryContentType;
    readonly title: string;
    readonly addedAt: string;
    readonly position: number;
}

/**
 * Favorites spread over the portals, live, movie and series in turn. The
 * (type, portal, row) triple is injective in the index, so two favorites
 * never share a playlist, type and `xtream_id` whatever the catalog size.
 */
export function favoriteRows(
    spec: LargeLibraryProfileSpec
): LargeLibraryFavoriteRow[] {
    return Array.from({ length: spec.favorites }, (_, index) => {
        const type = CONTENT_TYPES[index % 3] as LargeLibraryContentType;
        const ordinal = Math.floor(index / 3);
        const portal = ordinal % spec.xtreamPortals;
        const row = Math.floor(ordinal / spec.xtreamPortals) + 1;
        const content = contentRowOf(portal, type, row, spec);
        return {
            id: index + 1,
            contentId: content.id,
            playlistId: xtreamPlaylistId(portal),
            xtreamId: content.xtreamId,
            type,
            title: content.title,
            addedAt: sqliteTimestampAt(-600 * (index + 1)),
            position: index,
        };
    });
}

export interface LargeLibraryHistoryRow {
    readonly id: number;
    readonly contentId: number;
    readonly playlistId: string;
    readonly viewedAt: string;
    readonly content: LargeLibraryContentRow;
}

/**
 * The Xtream history: movies and series on two of every three rows (the
 * rows Continue Watching reads), a live channel on the third, newest first
 * by index, spread over about half of the portals.
 */
export function historyRows(
    spec: LargeLibraryProfileSpec
): LargeLibraryHistoryRow[] {
    const portals = Math.max(1, Math.floor(spec.xtreamPortals / 2));
    return Array.from({ length: spec.historyItems }, (_, index) => {
        const type = (['movie', 'series', 'live'] as const)[index % 3];
        const ordinal = Math.floor(index / 3);
        const portal = ordinal % portals;
        // Rows from the far end of each type, apart from the favorites.
        const row = 1_000 + Math.floor(ordinal / portals);
        const content = contentRowOf(portal, type, row, spec);
        return {
            id: index + 1,
            contentId: content.id,
            playlistId: xtreamPlaylistId(portal),
            viewedAt: sqliteTimestampAt(-300 * (index + 1)),
            content,
        };
    });
}

export interface LargeLibraryPlaybackPositionRow {
    readonly id: number;
    readonly playlistId: string;
    readonly contentXtreamId: number;
    readonly contentType: 'episode' | 'vod';
    readonly seriesXtreamId: number | null;
    readonly seasonNumber: number | null;
    readonly episodeNumber: number | null;
    readonly positionSeconds: number;
    readonly durationSeconds: number;
    readonly updatedAt: string;
}

/**
 * A position for every movie and series row of the history (every fifth
 * movie finished, the rest unfinished so Continue Watching shows them), plus
 * further episode rows of the history's series.
 */
export function playbackPositionRows(
    spec: LargeLibraryProfileSpec
): LargeLibraryPlaybackPositionRow[] {
    const rows: LargeLibraryPlaybackPositionRow[] = [];
    const history = historyRows(spec).filter(
        (row) => row.content.type !== 'live'
    );
    for (const [index, row] of history.entries()) {
        const movie = row.content.type === 'movie';
        const duration = 5_400 + (index % 7) * 600;
        rows.push({
            id: rows.length + 1,
            playlistId: row.playlistId,
            // Episode ids: series id, season and episode, unique per row.
            contentXtreamId: movie
                ? row.content.xtreamId
                : row.content.xtreamId * 1_000 + 100 + (index % 8) + 1,
            contentType: movie ? 'vod' : 'episode',
            seriesXtreamId: movie ? null : row.content.xtreamId,
            seasonNumber: movie ? null : 1,
            episodeNumber: movie ? null : (index % 8) + 1,
            positionSeconds:
                movie && index % 5 === 4
                    ? Math.floor(duration * 0.95)
                    : Math.floor(duration * 0.35),
            durationSeconds: duration,
            updatedAt: sqliteTimestampAt(-300 * (index + 1)),
        });
    }
    const series = history.filter((row) => row.content.type === 'series');
    for (let index = 0; index < spec.extraEpisodePositions; index += 1) {
        const row = series[index % Math.max(1, series.length)];
        if (row === undefined) break;
        const episode = (index % 6) + 2;
        const season = 2 + Math.floor(index / series.length);
        rows.push({
            id: rows.length + 1,
            playlistId: row.playlistId,
            contentXtreamId:
                row.content.xtreamId * 1_000 + 100 * season + episode,
            contentType: 'episode',
            seriesXtreamId: row.content.xtreamId,
            seasonNumber: season,
            episodeNumber: episode,
            positionSeconds: 1_200,
            durationSeconds: 2_700,
            updatedAt: sqliteTimestampAt(-3_600 * (index + 2)),
        });
    }
    return rows;
}

export interface LargeLibraryEpgChannelRow {
    readonly id: string;
    readonly displayName: string;
    readonly sourceUrl: string;
}

export interface LargeLibraryEpgProgramRow {
    readonly channelId: string;
    readonly start: string;
    readonly stop: string;
    readonly title: string;
    readonly sourceUrl: string;
}

export function epgChannelRows(
    spec: LargeLibraryProfileSpec
): LargeLibraryEpgChannelRow[] {
    return Array.from({ length: spec.epgChannels }, (_, index) => ({
        id: `large-1-${index + 1}`,
        displayName: `${largeLibraryTitle(index)} ${index + 1}`,
        sourceUrl: LARGE_LIBRARY_EPG_SOURCE_URL,
    }));
}

/** Back-to-back half-hour programmes from the fixed epoch, per channel. */
export function* epgProgramRows(
    spec: LargeLibraryProfileSpec
): Generator<LargeLibraryEpgProgramRow> {
    for (const channel of epgChannelRows(spec)) {
        for (let slot = 0; slot < spec.epgProgramsPerChannel; slot += 1) {
            yield {
                channelId: channel.id,
                start: isoAt(slot * 1_800),
                stop: isoAt((slot + 1) * 1_800),
                title: largeLibraryTitle(
                    slot * 97 + Number(channel.id.split('-').at(-1))
                ),
                sourceUrl: LARGE_LIBRARY_EPG_SOURCE_URL,
            };
        }
    }
}

/** Row counts the generator must end up with; checked after generation. */
export function expectedRowCounts(
    spec: LargeLibraryProfileSpec
): Record<string, number> {
    const perPortal =
        spec.categoriesPerPortal.live +
        spec.categoriesPerPortal.movies +
        spec.categoriesPerPortal.series;
    const m3uChannels = Array.from({ length: spec.m3uPlaylists }, (_, index) =>
        m3uChannelCount(index, spec)
    ).reduce((total, count) => total + count, 0);
    return {
        playlists: spec.xtreamPortals + spec.stalkerPortals + spec.m3uPlaylists,
        categories: spec.xtreamPortals * perPortal,
        content: spec.xtreamPortals * spec.contentPerPortal,
        favorites: spec.favorites,
        recently_viewed: spec.historyItems,
        playback_positions: playbackPositionRows(spec).length,
        epg_channels: spec.epgChannels,
        epg_programs: spec.epgChannels * spec.epgProgramsPerChannel,
        m3uChannels,
    };
}
