import type { ParentalLockService } from '@iptvnator/services';
import {
    ALL_CATEGORIES_WITHHELD,
    createPortalRequestError,
    type PlaylistMeta,
    readPortalRequestFailure,
} from '@iptvnator/shared/interfaces';
import type { StalkerVodSource } from './models';
import { StalkerContentTypes } from './stalker-content-types';
import { getStalkerRequestErrorStatus } from './stalker-portal-discovery.utils';
import type { StalkerRequestOptions } from './stalker-request-options';
import { isStalkerAuthorizationFailure } from './stalker-response-classification';
import { processItemUrls } from './stores/utils/stalker-content-mappers';
import {
    executeStalkerRequest,
    type StalkerRequestDeps,
} from './stores/utils/stalker-request.utils';

export type StalkerSearchContentType = 'vod' | 'series';

export interface StalkerSearchPage {
    rawItems: StalkerVodSource[];
    totalItems: number | undefined;
}

interface StalkerSearchPayload {
    data?: StalkerVodSource[] | null;
    total_items?: number;
    error?: unknown;
}

interface StalkerSearchResponse {
    js?: StalkerSearchPayload | unknown[] | false | null;
    error?: unknown;
}

export async function loadStalkerSearchPage(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    type: StalkerSearchContentType,
    term: string,
    page: number,
    options?: StalkerRequestOptions
): Promise<StalkerSearchPage> {
    // Match the STB request shape. Portals can ignore the page-size hint.
    const response = await executeStalkerRequest<StalkerSearchResponse>(
        deps,
        playlist,
        {
            action: StalkerContentTypes[type].getContentAction,
            type,
            sortby: 'added',
            search: term,
            p: page,
            max_page_items: 100,
            category: '*',
            ...(type === 'vod' ? { genre: '0' } : {}),
        },
        options
    );
    if (isStalkerAuthorizationFailure(response)) {
        throw new Error('Stalker search authorization failed');
    }
    const transportFailure = readPortalRequestFailure(response);
    if (transportFailure) {
        throw createPortalRequestError(transportFailure, 'stalker');
    }
    const js = response?.js;
    const payload = js && !Array.isArray(js) ? js : undefined;
    const status = getStalkerRequestErrorStatus(response);
    if ((status ?? 0) >= 400 || response?.error || payload?.error) {
        throw new Error('Stalker search request failed');
    }
    const rows = payload?.data;
    const totalItems = payload?.total_items;
    if (Array.isArray(rows)) {
        return {
            rawItems: rows.map((item) =>
                processItemUrls(item, playlist.portalUrl ?? '')
            ),
            totalItems,
        };
    }
    if (
        js === null ||
        js === false ||
        (Array.isArray(js) && js.length === 0) ||
        (rows == null && totalItems === 0)
    ) {
        return { rawItems: [], totalItems };
    }
    throw new Error('Malformed Stalker search response');
}

/** Search must apply the parental lock for the catalog each row came from. */
export function resolveSearchWithheldCategoryIds(
    parentalLock: ParentalLockService,
    playlistId: string,
    contentType: StalkerSearchContentType
): ReadonlySet<string> {
    if (!parentalLock.active()) {
        return new Set();
    }
    if (parentalLock.withholdsEverything?.()) {
        return ALL_CATEGORIES_WITHHELD;
    }
    return new Set(parentalLock.lockedStalkerIds(playlistId, contentType));
}
