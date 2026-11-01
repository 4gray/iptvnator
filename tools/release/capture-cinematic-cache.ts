/** Offline metadata for the explicit cinematic preset. Never contacts TMDB. */
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    XTREAM_FIXTURE_CREDENTIALS,
    XTREAM_MOCK_ORIGIN,
} from './capture-fixtures';

export const SYNTHETIC_METADATA_KEY = 'iptvnator-synthetic-offline-fixture';

// This tool owns wire fixtures, not application-library imports. The full
// Electron capture verifies these versioned keys against the real resolver.
type TmdbCacheEntry = Parameters<
    NonNullable<Window['electron']>['dbSetTmdbMetadata']
>[0];
const buildDetailsLookupKey = (id: number) => `id:${id}|v2`;
const buildSearchLookupKey = (title: string, year: number | null) =>
    `title:${title.toLowerCase()}|year:${year ?? ''}|v4`;

interface CatalogItem {
    name: string;
    stream_id?: number;
    series_id?: number;
}
interface ProviderInfo {
    name: string;
    plot: string;
    genre: string;
    rating: number | string;
    releasedate?: string;
    releaseDate?: string;
    duration_secs?: number;
}
interface ProviderDetails {
    info: ProviderInfo;
    seasons?: Array<{
        season_number: number;
        overview: string;
        air_date: string;
    }>;
    episodes?: Record<
        string,
        Array<{
            id: string;
            episode_num: number;
            title: string;
            info: { plot: string; duration_secs: number; releasedate: string };
        }>
    >;
}

async function providerJson<T>(
    action: string,
    params: Record<string, string> = {}
): Promise<T> {
    const url = new URL('/player_api.php', XTREAM_MOCK_ORIGIN);
    url.search = new URLSearchParams({
        ...XTREAM_FIXTURE_CREDENTIALS,
        action,
        ...params,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok)
        throw new Error(`Synthetic provider action failed: ${action}`);
    return response.json() as Promise<T>;
}

/** Image paths stay null: provider-owned local artwork remains authoritative. */
export function cinematicCacheRows(
    mediaType: 'movie' | 'tv',
    id: number,
    details: ProviderDetails
): TmdbCacheEntry[] {
    const info = details.info;
    const date = info.releasedate ?? info.releaseDate ?? '';
    const year = Number(date.slice(0, 4));
    const payload = {
        id,
        title: info.name,
        original_title: info.name,
        name: info.name,
        original_name: info.name,
        original_language: 'en',
        overview: info.plot,
        release_date: date,
        first_air_date: date,
        vote_average: Number(info.rating),
        vote_count: 240,
        genres: info.genre
            .split(/,| & /)
            .map((name, index) => ({ id: index + 1, name: name.trim() })),
        runtime: Math.round((info.duration_secs ?? 2640) / 60),
        poster_path: null,
        backdrop_path: null,
        credits: { cast: [], crew: [] },
        videos: { results: [] },
        seasons: (details.seasons ?? []).map((season) => ({
            ...season,
            poster_path: null,
        })),
    };
    const row = (lookupKey: string, body: unknown): TmdbCacheEntry => ({
        mediaType,
        lookupKey,
        language: 'en-US',
        tmdbId: id,
        payload: body === null ? null : JSON.stringify(body),
    });
    return [
        row(buildDetailsLookupKey(id), payload),
        ...[null, year].map((value) =>
            row(buildSearchLookupKey(info.name, value), null)
        ),
        ...(details.seasons ?? []).map((season) =>
            row(`id:${id}|season:${season.season_number}`, {
                ...season,
                name: `Season ${season.season_number}`,
                poster_path: null,
                episodes: (
                    details.episodes?.[String(season.season_number)] ?? []
                ).map((episode) => ({
                    id: Number(episode.id),
                    episode_number: episode.episode_num,
                    season_number: season.season_number,
                    name: episode.title,
                    overview: episode.info.plot,
                    air_date: episode.info.releasedate,
                    runtime: Math.round(episode.info.duration_secs / 60),
                    still_path: null,
                })),
            })
        ),
    ];
}

export async function seedCinematicMetadata(page: Page): Promise<void> {
    const rows: TmdbCacheEntry[] = [];
    for (const type of ['movie', 'tv'] as const) {
        const catalog = await providerJson<CatalogItem[]>(
            type === 'movie' ? 'get_vod_streams' : 'get_series'
        );
        for (const item of catalog) {
            const id = item.stream_id ?? item.series_id;
            if (!id) throw new Error('Synthetic catalog identity missing');
            const details = await providerJson<ProviderDetails>(
                type === 'movie' ? 'get_vod_info' : 'get_series_info',
                type === 'movie'
                    ? { vod_id: String(id) }
                    : { series_id: String(id) }
            );
            rows.push(...cinematicCacheRows(type, id, details));
        }
    }
    await page.evaluate(async (entries) => {
        if (!window.electron?.dbSetTmdbMetadata)
            throw new Error('Metadata cache bridge unavailable');
        for (const entry of entries)
            await window.electron.dbSetTmdbMetadata(entry);
    }, rows);

    // Settings are written only in the newly created capture profile; reload
    // makes the real settings store and normal enrichment path consume them.
    await page.evaluate(async (key) => {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('ngStorage');
            request.onerror = () =>
                reject(new Error('Cannot open demo settings'));
            request.onsuccess = () => {
                const db = request.result;
                const transaction = db.transaction('localStorage', 'readwrite');
                const store = transaction.objectStore('localStorage');
                const get = store.get('settings');
                get.onsuccess = () =>
                    store.put(
                        {
                            ...get.result,
                            language: 'en',
                            tmdb: { enabled: true, apiKey: key },
                            dashboardRails: {
                                ...get.result?.dashboardRails,
                                tmdbTrending: false,
                                tmdbRecommendations: false,
                            },
                        },
                        'settings'
                    );
                transaction.oncomplete = () => {
                    db.close();
                    resolve();
                };
                transaction.onerror = () => {
                    db.close();
                    reject(new Error('Cannot save demo settings'));
                };
            };
        });
    }, SYNTHETIC_METADATA_KEY);
    await page.goto(
        pathToFileURL(path.resolve('dist/apps/web/index.html')).href
    );
    await page.waitForSelector('app-workspace-shell-rail', { timeout: 30_000 });
}
