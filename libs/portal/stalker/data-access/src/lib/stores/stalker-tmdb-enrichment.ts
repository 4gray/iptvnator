import {
    TmdbEnrichmentService,
    extractYear,
    loadTmdbMergers,
    type TmdbMatchIdentity,
} from '@iptvnator/services';
import { StalkerVodInfo, TmdbMediaType } from '@iptvnator/shared/interfaces';
import { StalkerVodSource } from '../models';
import {
    firstNonBlankStalkerIdText,
    isStalkerSeriesItem,
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
    currentPlaylist?: () => { _id?: string } | undefined;
    selectedContentType?: () => string;
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
    const info = (item.info?.tmdb_provider_info ??
        item.info ??
        {}) as Partial<StalkerVodInfo>;
    const title = info?.name?.trim() ?? '';

    const itemId = firstNonBlankStalkerIdText(item.id, item.stream_id);
    const playlistId = store.currentPlaylist?.()?._id;
    const contentType = store.selectedContentType?.();
    const matchIdentity: TmdbMatchIdentity | undefined =
        playlistId && itemId
            ? {
                  provider: 'stalker',
                  playlistId,
                  mediaType,
                  itemId,
                  catalog: contentType === 'series' ? 'series' : 'vod',
              }
            : undefined;
    const matches = enrichment.matches;
    const version = matchIdentity ? matches?.version(matchIdentity) : undefined;
    const isCurrent = (): StalkerVodSource | null => {
        if (
            matchIdentity &&
            (store.currentPlaylist?.()?._id !== playlistId ||
                store.selectedContentType?.() !== contentType ||
                matches?.version(matchIdentity) !== version)
        )
            return null;
        const current = store.selectedItem();
        if (!current) {
            return null;
        }
        const sameEntity = itemId
            ? firstNonBlankStalkerIdText(current.id, current.stream_id) ===
              itemId
            : current === item;
        return sameEntity ? current : null;
    };

    if (matchIdentity && matches) {
        matches.register(store, matchIdentity, async () => {
            // The old request version is intentionally not checked on explicit refresh.
            const current = store.selectedItem();
            if (
                store.currentPlaylist?.()?._id !== playlistId ||
                store.selectedContentType?.() !== contentType ||
                !current ||
                firstNonBlankStalkerIdText(current.id, current.stream_id) !==
                    itemId
            )
                return;
            const restored = { ...current, info };
            applyEnrichedItem(restored);
            await enrichStalkerSelectionWithTmdb(
                store,
                enrichment,
                restored,
                mediaType,
                applyEnrichedItem
            );
        });
    }

    // A saved enriched snapshot must also honor a provider-only choice on reopen.
    if (
        item.info?.tmdb_provider_info ||
        !enrichment.isEnabled() ||
        (matchIdentity && matches?.read(matchIdentity)?.mode === 'provider')
    ) {
        const current = isCurrent();
        if (current) applyEnrichedItem({ ...current, info });
    }
    if (
        !enrichment.isEnabled() ||
        (matchIdentity && matches?.read(matchIdentity)?.mode === 'provider')
    )
        return;

    if (
        (!title || title === 'Unknown') &&
        (!matchIdentity || matches?.read(matchIdentity)?.mode !== 'manual')
    )
        return;

    const query = {
        title,
        originalTitle: info?.o_name,
        year: extractYear(info?.releasedate, title),
        ...(matchIdentity ? { matchIdentity } : {}),
    };
    const details =
        mediaType === 'tv'
            ? await enrichment.enrichTv(query)
            : await enrichment.enrichMovie(query);
    if (!details) {
        return;
    }

    const mergers = await loadTmdbMergers().catch(() => null);
    if (!mergers) return;

    const current = isCurrent();
    if (!current) {
        return;
    }

    try {
        applyEnrichedItem({
            ...current,
            info: {
                ...mergers.mergeStalkerInfoWithTmdb(
                    info as StalkerVodInfo,
                    details,
                    mediaType
                ),
                tmdb_provider_info: info as StalkerVodInfo,
            },
        });
    } catch (error) {
        // Never degrade provider data over a malformed payload shape
        console.warn('[TMDB] Stalker merge failed:', error);
    }
}
