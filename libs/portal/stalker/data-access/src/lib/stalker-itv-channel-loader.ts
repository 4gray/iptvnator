import {
    PlaylistMeta,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerItvChannel } from './models';
import {
    StalkerRequestDeps,
    executeStalkerRequest,
    toStalkerContentItem,
    toStalkerItvChannel,
} from './stores/utils';

export interface StalkerItvLoadProgress {
    loaded: number;
    total: number;
}

/**
 * 'unsupported' — the portal answered but cannot serve a full list; the caller
 * should keep the legacy paged flow. 'error' — a transient failure (network,
 * timeout, a page that failed both attempts) that is worth retrying later.
 */
export type StalkerItvLoadOutcome =
    | StalkerItvChannel[]
    | 'unsupported'
    | 'error';

export interface StalkerItvLoadLogger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}

interface StalkerChannelListResponse {
    js?: {
        data?: unknown;
        total_items?: number | string;
        max_page_items?: number | string;
    };
}

const FALLBACK_PAGE_SIZE = 14;
const CRAWL_CONCURRENCY = 4;
/** Hard cap so a misbehaving portal cannot make the crawl run forever. */
const MAX_CHANNELS = 30_000;

function toPositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Loads the complete ITV channel list for a portal. First tries the Ministra
 * `get_all_channels` action (all channels in one response — the same call STB
 * clients use); if that isn't usable, crawls `get_ordered_list` pages. Stateless
 * — the {@link StalkerItvCacheService} owns caching, progress state, and retry
 * throttling.
 */
export async function loadFullItvChannelList(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    onProgress: (loaded: number, total: number) => void,
    logger: StalkerItvLoadLogger
): Promise<StalkerItvLoadOutcome> {
    const viaAllChannels = await tryGetAllChannels(deps, playlist, logger);
    if (Array.isArray(viaAllChannels)) {
        return viaAllChannels;
    }

    const crawled = await crawlOrderedPages(deps, playlist, onProgress, logger);
    if (Array.isArray(crawled)) {
        return crawled;
    }

    return viaAllChannels === 'error' || crawled === 'error'
        ? 'error'
        : 'unsupported';
}

async function tryGetAllChannels(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    logger: StalkerItvLoadLogger
): Promise<StalkerItvLoadOutcome> {
    try {
        const response =
            await executeStalkerRequest<StalkerChannelListResponse>(
                deps,
                playlist,
                {
                    action: StalkerPortalActions.GetAllChannels,
                    type: 'itv',
                }
            );
        const data = response?.js?.data;
        if (!Array.isArray(data) || data.length === 0) {
            logger.info(
                'get_all_channels not usable, falling back to page crawl'
            );
            return 'unsupported';
        }

        return mapChannels(data, playlist);
    } catch (error) {
        logger.warn('get_all_channels failed', error);
        return 'error';
    }
}

async function crawlOrderedPages(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    onProgress: (loaded: number, total: number) => void,
    logger: StalkerItvLoadLogger
): Promise<StalkerItvLoadOutcome> {
    const firstResponse = await fetchOrderedPageWithRetry(deps, playlist, 1, logger);
    if (firstResponse === null) {
        return 'error';
    }

    const firstPage = Array.isArray(firstResponse.js?.data)
        ? firstResponse.js.data
        : null;
    if (firstPage === null || firstPage.length === 0) {
        return 'unsupported';
    }

    const totalItems = Math.min(
        toPositiveInt(firstResponse?.js?.total_items) ?? firstPage.length,
        MAX_CHANNELS
    );
    const pageSize =
        toPositiveInt(firstResponse?.js?.max_page_items) ??
        (firstPage.length || FALLBACK_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    const items: unknown[] = [];
    const seen = new Set<string>();
    collectUnique(firstPage, items, seen);
    onProgress(items.length, totalItems);

    for (
        let page = 2;
        page <= totalPages && items.length < totalItems;
        page += CRAWL_CONCURRENCY
    ) {
        const batch: number[] = [];
        for (
            let next = page;
            next < page + CRAWL_CONCURRENCY && next <= totalPages;
            next++
        ) {
            batch.push(next);
        }

        const results = await Promise.all(
            batch.map((pageNumber) =>
                fetchOrderedPageWithRetry(deps, playlist, pageNumber, logger)
            )
        );

        let reachedEnd = false;
        for (const pageResponse of results) {
            const pageItems = Array.isArray(pageResponse?.js?.data)
                ? pageResponse.js.data
                : null;
            if (pageItems === null) {
                logger.warn('Aborting ITV page crawl after failures');
                return 'error';
            }
            const added = collectUnique(pageItems, items, seen);
            if (added === 0) {
                // Empty page, or a portal that ignores `p` and keeps returning
                // already-seen channels — treat the collected list as complete
                // instead of duplicating rows forever.
                reachedEnd = true;
                break;
            }
        }

        onProgress(Math.min(items.length, totalItems), totalItems);
        if (reachedEnd) {
            break;
        }
    }

    return mapChannels(items, playlist);
}

/**
 * Appends only channels whose id hasn't been seen yet. Returns how many new
 * channels were added so the crawl can stop when a page contributes nothing new.
 */
function collectUnique(
    rawItems: unknown[],
    target: unknown[],
    seen: Set<string>
): number {
    let added = 0;
    for (const item of rawItems) {
        const id = rawChannelId(item);
        if (id === null || seen.has(id)) {
            continue;
        }
        seen.add(id);
        target.push(item);
        added += 1;
    }
    return added;
}

function rawChannelId(item: unknown): string | null {
    if (!item || typeof item !== 'object') {
        return null;
    }
    const source = item as { id?: unknown; stream_id?: unknown };
    const raw = source.id ?? source.stream_id;
    return raw === undefined || raw === null || raw === '' ? null : String(raw);
}

async function fetchOrderedPageWithRetry(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    page: number,
    logger: StalkerItvLoadLogger
): Promise<StalkerChannelListResponse | null> {
    const firstAttempt = await fetchOrderedPage(deps, playlist, page, logger);
    if (firstAttempt !== null) {
        return firstAttempt;
    }
    return fetchOrderedPage(deps, playlist, page, logger);
}

async function fetchOrderedPage(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    page: number,
    logger: StalkerItvLoadLogger
): Promise<StalkerChannelListResponse | null> {
    try {
        return await executeStalkerRequest<StalkerChannelListResponse>(
            deps,
            playlist,
            {
                action: StalkerPortalActions.GetOrderedList,
                type: 'itv',
                category: '*',
                genre: '*',
                sortby: 'number',
                p: page,
            }
        );
    } catch (error) {
        logger.warn(`Failed to fetch ITV page ${page}`, error);
        return null;
    }
}

function mapChannels(
    items: unknown[],
    playlist: PlaylistMeta
): StalkerItvChannel[] {
    const mapped: StalkerItvChannel[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        const channel = toStalkerItvChannel(
            toStalkerContentItem(
                item as Parameters<typeof toStalkerContentItem>[0],
                playlist.portalUrl ?? ''
            )
        );
        // Duplicate channel ids collide with the template's `track item.id`
        // (get_all_channels can repeat, and some crawl paths overlap).
        const id = String(channel.id ?? '');
        if (id !== '' && seen.has(id)) {
            continue;
        }
        if (id !== '') {
            seen.add(id);
        }
        mapped.push(channel);
    }
    return mapped;
}
