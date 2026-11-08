import type { StalkerVodSource } from './models';
import { StalkerContentTypes } from './stalker-content-types';

export type StalkerSearchContentType = 'vod' | 'series';

export interface StalkerSearchResponse {
    js?: { data?: StalkerVodSource[]; total_items?: number };
    message?: string;
    status?: number;
}

/**
 * Ministra may return an empty page without the STB's catalog parameters.
 * `max_page_items` is a hint; consumers must not rely on it for paging.
 */
export function buildStalkerSearchRequestParams(
    contentType: StalkerSearchContentType,
    search: string,
    page: number
): Record<string, string | number> {
    return {
        action: StalkerContentTypes[contentType].getContentAction,
        type: contentType,
        sortby: 'added',
        search,
        p: page,
        max_page_items: 100,
        category: '*',
        ...(contentType === 'vod' ? { genre: '0' } : {}),
    };
}
