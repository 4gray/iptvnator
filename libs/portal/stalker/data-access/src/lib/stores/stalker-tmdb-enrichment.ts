import {
    TmdbEnrichmentService,
    extractYear,
    mergeStalkerInfoWithTmdb,
} from '@iptvnator/services';
import { StalkerVodInfo, TmdbMediaType } from '@iptvnator/shared/interfaces';
import { StalkerVodSource } from '../models';
import {
    isStalkerSeriesItem,
    normalizeStalkerEntityId,
} from '../stalker-vod.utils';

/**
 * Async TMDB enrichment of the currently selected Stalker item. Runs after
 * `setSelectedItem`; the enriched item is applied through a dedicated
 * callback (direct `patchState`) instead of `setSelectedItem` so the hook
 * cannot recurse. Movies and series share the same `StalkerVodInfo` shape,
 * so one code path covers both — only the TMDB media type differs.
 *
 * Stalker portals never expose a TMDB id, so resolution always goes
 * through the title search with the confidence gate. Cyrillic titles are
 * handled by the search-language override in TmdbEnrichmentService.
 */

interface StalkerEnrichableStore {
    selectedItem: () => StalkerVodSource | null | undefined;
}

export function stalkerSelectionMediaType(
    item: StalkerVodSource,
    contentType: string
): TmdbMediaType {
    return contentType === 'series' || isStalkerSeriesItem(item)
        ? 'tv'
        : 'movie';
}

export async function enrichStalkerSelectionWithTmdb(
    store: StalkerEnrichableStore,
    enrichment: TmdbEnrichmentService,
    item: StalkerVodSource,
    mediaType: TmdbMediaType,
    applyEnrichedItem: (enriched: StalkerVodSource) => void
): Promise<void> {
    if (!enrichment.isEnabled()) {
        return;
    }

    const info = item.info as Partial<StalkerVodInfo> | null | undefined;
    const title = info?.name?.trim();
    if (!title || title === 'Unknown') {
        return;
    }

    const itemId = normalizeStalkerEntityId(item.id ?? item.stream_id);
    const isCurrent = (): StalkerVodSource | null => {
        const current = store.selectedItem();
        if (!current) {
            return null;
        }
        const matches = itemId
            ? normalizeStalkerEntityId(current.id ?? current.stream_id) ===
              itemId
            : current === item;
        return matches ? current : null;
    };

    const query = {
        title,
        originalTitle: info?.o_name,
        year: extractYear(info?.releasedate, title),
    };
    const details =
        mediaType === 'tv'
            ? await enrichment.enrichTv(query)
            : await enrichment.enrichMovie(query);
    if (!details) {
        return;
    }

    const current = isCurrent();
    const currentInfo = current?.info as StalkerVodInfo | null | undefined;
    if (!current || !currentInfo?.name) {
        return;
    }

    applyEnrichedItem({
        ...current,
        info: mergeStalkerInfoWithTmdb(currentInfo, details, mediaType),
    });
}
