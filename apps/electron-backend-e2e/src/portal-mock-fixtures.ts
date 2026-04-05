import { APIRequestContext } from '@playwright/test';
import {
    defaultStalkerMacAddress,
    expect,
    stalkerMockServer,
    xtreamMockServer,
} from './electron-test-fixtures';

export type XtreamCategory = {
    category_id: string;
    category_name: string;
};

export type XtreamLiveStream = {
    added?: string;
    category_id?: string;
    epg_channel_id?: string;
    name?: string;
    stream_id?: number | string;
    stream_type?: string;
    tv_archive?: number | string;
    tv_archive_duration?: number | string;
};

export type XtreamVodStream = {
    added?: string;
    category_id?: string;
    name?: string;
    stream_id?: number | string;
};

export type XtreamSeriesItem = {
    added?: string;
    category_id?: number | string;
    last_modified?: string;
    name?: string;
    releaseDate?: string;
    series_id?: number | string;
};

export type XtreamCategoryFixture<T> = {
    categoryId: string;
    categoryName: string;
    items: T[];
};

export type XtreamRawEpgListing = {
    channel_id?: string;
    description?: string;
    end?: string;
    epg_id?: string;
    id?: string;
    lang?: string;
    start?: string;
    start_timestamp?: string;
    stop_timestamp?: string;
    title?: string;
};

export type XtreamNormalizedEpgListing = {
    channelId: string;
    description: string;
    end: string;
    id: string;
    rawDescription: string;
    rawEnd: string;
    rawStart: string;
    rawTitle: string;
    start: string;
    startTimestamp: number;
    stopTimestamp: number;
    title: string;
};

export type XtreamEpgFixture = {
    categoryId: string;
    categoryName: string;
    fullEpg: XtreamNormalizedEpgListing[];
    rawFullEpg: XtreamRawEpgListing[];
    rawShortEpg: XtreamRawEpgListing[];
    shortEpg: XtreamNormalizedEpgListing[];
    stream: XtreamLiveStream;
};

type StalkerCategory = {
    id: string;
    title: string;
};

type StalkerProxyPayload<T> = {
    payload: {
        js: T;
    };
};

type StalkerOrderedList<T> = {
    data: T[];
};

type StalkerSeasonLike = {
    id?: number | string;
};

export type StalkerContentItem = {
    id?: number | string;
    name?: string;
    o_name?: string;
};

export type StalkerCategoryFixture = {
    categoryId: string;
    categoryName: string;
    items: StalkerContentItem[];
};

export async function fetchXtreamLiveFixture(
    request: APIRequestContext,
    credentials = { username: 'minimal', password: 'minimal' }
): Promise<XtreamCategoryFixture<XtreamLiveStream>> {
    return fetchXtreamFixture<XtreamLiveStream>(request, {
        categoriesAction: 'get_live_categories',
        itemsAction: 'get_live_streams',
        ...credentials,
    });
}

export async function fetchXtreamVodFixture(
    request: APIRequestContext,
    credentials = { username: 'minimal', password: 'minimal' }
): Promise<XtreamCategoryFixture<XtreamVodStream>> {
    return fetchXtreamFixture<XtreamVodStream>(request, {
        categoriesAction: 'get_vod_categories',
        itemsAction: 'get_vod_streams',
        ...credentials,
    });
}

export async function fetchXtreamSeriesFixture(
    request: APIRequestContext,
    credentials = { username: 'minimal', password: 'minimal' }
): Promise<XtreamCategoryFixture<XtreamSeriesItem>> {
    return fetchXtreamFixture<XtreamSeriesItem>(request, {
        categoriesAction: 'get_series_categories',
        itemsAction: 'get_series',
        ...credentials,
    });
}

export async function fetchXtreamEpgFixture(
    request: APIRequestContext,
    credentials = { username: 'epg', password: 'epg' }
): Promise<XtreamEpgFixture> {
    const liveFixture = await fetchXtreamLiveFixture(request, credentials);
    const stream = liveFixture.items[0];
    if (!stream) {
        throw new Error('Xtream EPG fixture returned no live stream.');
    }
    const streamId = Number(stream.stream_id);

    if (!Number.isFinite(streamId) || streamId <= 0) {
        throw new Error('Xtream EPG fixture returned an invalid stream id.');
    }

    const rawShortResponse = await fetchJson<{
        epg_listings?: XtreamRawEpgListing[];
    }>(
        request,
        `${xtreamMockServer}/player_api.php?action=get_short_epg&username=${encodeURIComponent(
            credentials.username
        )}&password=${encodeURIComponent(
            credentials.password
        )}&stream_id=${streamId}&limit=3`
    );
    const rawFullResponse = await fetchJson<{
        epg_listings?: XtreamRawEpgListing[];
    }>(
        request,
        `${xtreamMockServer}/player_api.php?action=get_simple_data_table&username=${encodeURIComponent(
            credentials.username
        )}&password=${encodeURIComponent(
            credentials.password
        )}&stream_id=${streamId}`
    );

    const rawShortEpg = rawShortResponse.epg_listings ?? [];
    const rawFullEpg = rawFullResponse.epg_listings ?? [];

    if (rawShortEpg.length === 0 || rawFullEpg.length === 0) {
        throw new Error('Xtream EPG fixture returned no schedule data.');
    }

    return {
        categoryId: liveFixture.categoryId,
        categoryName: liveFixture.categoryName,
        stream,
        rawShortEpg,
        rawFullEpg,
        shortEpg: normalizeXtreamEpgListings(rawShortEpg),
        fullEpg: normalizeXtreamEpgListings(rawFullEpg),
    };
}

export async function fetchStalkerCategoryFixture(
    request: APIRequestContext,
    type: 'itv' | 'series' | 'vod'
): Promise<StalkerCategoryFixture> {
    const categoriesResponse = await fetchJson<
        StalkerProxyPayload<StalkerCategory[]>
    >(
        request,
        buildStalkerProxyUrl('get_categories', {
            type,
        })
    );
    const categories = categoriesResponse.payload.js ?? [];

    for (const category of categories) {
        const itemsResponse = await fetchJson<
            StalkerProxyPayload<StalkerOrderedList<StalkerContentItem>>
        >(
            request,
            buildStalkerProxyUrl('get_ordered_list', {
                category: String(category.id),
                p: '1',
                type,
            })
        );
        const items = itemsResponse.payload.js.data ?? [];

        if (items.length > 0) {
            if (type === 'series') {
                const playableSeries = await findPlayableStalkerSeriesItem(
                    request,
                    items
                );

                if (!playableSeries) {
                    continue;
                }

                return {
                    categoryId: String(category.id),
                    categoryName: category.title,
                    items: [
                        playableSeries,
                        ...items.filter(
                            (item) =>
                                String(item.id ?? '') !==
                                String(playableSeries.id ?? '')
                        ),
                    ],
                };
            }

            return {
                categoryId: String(category.id),
                categoryName: category.title,
                items,
            };
        }
    }

    throw new Error(`Stalker mock server returned no ${type} items.`);
}

export function getXtreamTitle(
    item: XtreamLiveStream | XtreamVodStream | XtreamSeriesItem
): string {
    return `${item.name ?? ''}`.trim();
}

export function getXtreamDateValue(
    item: XtreamVodStream | XtreamSeriesItem
): number {
    if ('last_modified' in item && item.last_modified) {
        return Number.parseInt(item.last_modified, 10) || 0;
    }

    return Number.parseInt(item.added ?? '', 10) || 0;
}

export function getStalkerTitle(item: StalkerContentItem): string {
    return `${item.o_name ?? item.name ?? ''}`.trim();
}

export function pickDistinctTitles<T>(
    items: T[],
    getTitle: (item: T) => string
): [string, string] {
    const titles = items
        .map((item) => getTitle(item))
        .map((title) => title.trim())
        .filter((title, index, allTitles) => {
            return (
                title.length > 0 &&
                allTitles.findIndex((candidate) => candidate === title) ===
                    index
            );
        });

    if (titles.length < 2) {
        throw new Error('Expected at least two distinct item titles.');
    }

    return [titles[0], titles[1]];
}

async function fetchXtreamFixture<T extends { category_id?: string | number }>(
    request: APIRequestContext,
    options: {
        categoriesAction: string;
        itemsAction: string;
        password: string;
        username: string;
    }
): Promise<XtreamCategoryFixture<T>> {
    const { categoriesAction, itemsAction, password, username } = options;
    const categories = await fetchJson<XtreamCategory[]>(
        request,
        `${xtreamMockServer}/player_api.php?action=${encodeURIComponent(
            categoriesAction
        )}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(
            password
        )}`
    );

    for (const category of categories) {
        const items = await fetchJson<T[]>(
            request,
            `${xtreamMockServer}/player_api.php?action=${encodeURIComponent(
                itemsAction
            )}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(
                password
            )}&category_id=${encodeURIComponent(category.category_id)}`
        );

        if (items.length > 0) {
            return {
                categoryId: String(category.category_id),
                categoryName: category.category_name,
                items,
            };
        }
    }

    throw new Error(`Xtream mock server returned no items for ${itemsAction}.`);
}

async function fetchJson<T>(
    request: APIRequestContext,
    url: string
): Promise<T> {
    const response = await request.get(url);

    expect(response.ok()).toBeTruthy();

    return (await response.json()) as T;
}

function normalizeXtreamEpgListings(
    listings: XtreamRawEpgListing[]
): XtreamNormalizedEpgListing[] {
    return listings
        .map((listing, index) => {
            const startTimestamp = Number.parseInt(
                String(listing.start_timestamp ?? ''),
                10
            );
            const stopTimestamp = Number.parseInt(
                String(listing.stop_timestamp ?? ''),
                10
            );

            return {
                id: String(listing.id ?? index),
                title: decodeXtreamText(String(listing.title ?? '')),
                description: decodeXtreamText(
                    String(listing.description ?? '')
                ),
                rawTitle: String(listing.title ?? ''),
                rawDescription: String(listing.description ?? ''),
                rawStart: String(listing.start ?? ''),
                rawEnd: String(listing.end ?? ''),
                start: new Date(startTimestamp * 1000).toISOString(),
                end: new Date(stopTimestamp * 1000).toISOString(),
                startTimestamp,
                stopTimestamp,
                channelId: String(listing.channel_id ?? listing.epg_id ?? ''),
            };
        })
        .sort((left, right) => left.startTimestamp - right.startTimestamp);
}

function decodeXtreamText(value: string): string {
    return Buffer.from(value, 'base64').toString('utf-8');
}

function buildStalkerProxyUrl(
    action: string,
    params: Record<string, string>
): string {
    const searchParams = new URLSearchParams({
        action,
        macAddress: defaultStalkerMacAddress,
        url: `${stalkerMockServer}/portal.php`,
        ...params,
    });

    return `${stalkerMockServer}/stalker?${searchParams.toString()}`;
}

async function findPlayableStalkerSeriesItem(
    request: APIRequestContext,
    items: StalkerContentItem[]
): Promise<StalkerContentItem | null> {
    for (const item of items) {
        const itemId = String(item.id ?? '').trim();

        if (!itemId) {
            continue;
        }

        const seasonsResponse = await fetchJson<
            StalkerProxyPayload<
                StalkerOrderedList<StalkerSeasonLike> | StalkerSeasonLike[]
            >
        >(
            request,
            buildStalkerProxyUrl('get_ordered_list', {
                movie_id: itemId,
                p: '1',
                type: 'series',
            })
        );
        const seasons = extractStalkerSeriesItems(seasonsResponse.payload.js);

        if (seasons.length > 0) {
            return item;
        }
    }

    return null;
}

function extractStalkerSeriesItems<T>(
    payload: StalkerOrderedList<T> | T[] | undefined
): T[] {
    if (Array.isArray(payload)) {
        return payload;
    }

    return payload?.data ?? [];
}
