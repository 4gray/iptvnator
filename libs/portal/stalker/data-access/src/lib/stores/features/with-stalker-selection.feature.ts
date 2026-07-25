import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { StalkerVodSource } from '../../models';
import {
    isStalkerSeriesItem,
    normalizeStalkerEntityId,
} from '../../stalker-vod.utils';
import {
    enrichStalkerSelectionWithTmdb,
    stalkerSelectionMediaType,
} from '../stalker-tmdb-enrichment';

/**
 * Selection/pagination/search feature state.
 */
export interface StalkerSelectionState {
    selectedContentType: 'vod' | 'itv' | 'series' | 'radio';
    selectedCategoryId: string | null | undefined;
    selectedVodId: string | undefined;
    selectedSerialId: string | undefined;
    selectedItvId: string | undefined;
    limit: number;
    page: number;
    searchPhrase: string;
    selectedItem: StalkerVodSource | null | undefined;
}

const initialSelectionState: StalkerSelectionState = {
    selectedContentType: 'vod',
    selectedCategoryId: undefined,
    selectedVodId: undefined,
    selectedSerialId: undefined,
    selectedItvId: undefined,
    limit: 14,
    page: 0,
    searchPhrase: '',
    selectedItem: undefined,
};

export function withStalkerSelection() {
    return signalStoreFeature(
        withState<StalkerSelectionState>(initialSelectionState),
        withMethods((store) => {
            const tmdbEnrichment = inject(TmdbEnrichmentService);

            return {
            setSelectedContentType(
                type: 'vod' | 'itv' | 'series' | 'radio'
            ) {
                patchState(store, { selectedContentType: type });
            },
            setSelectedCategory(id: string | number | null) {
                const newId =
                    id !== null && id !== undefined ? String(id) : null;
                if (store.selectedCategoryId() === newId) {
                    return;
                }
                patchState(store, {
                    selectedCategoryId: newId,
                    page: 0,
                });
            },
            setSelectedSerialId(id: string) {
                patchState(store, { selectedSerialId: id });
            },
            setSelectedVodId(id: string) {
                patchState(store, { selectedVodId: id });
            },
            setSelectedItvId(id: string) {
                patchState(store, { selectedItvId: id });
            },
            setLimit(limit: number) {
                if (store.limit() === limit) {
                    return;
                }

                patchState(store, { limit });
            },
            setPage(page: number) {
                if (store.page() === page) {
                    return;
                }

                patchState(store, { page });
            },
            setSearchPhrase(phrase: string) {
                if (store.searchPhrase() === phrase) {
                    return;
                }

                patchState(store, { searchPhrase: phrase, page: 0 });
            },
            setSelectedItem(selectedItem: StalkerVodSource | null | undefined) {
                const selectedIdRaw =
                    selectedItem?.id !== undefined && selectedItem?.id !== null
                        ? selectedItem.id
                        : undefined;
                const selectedId =
                    selectedIdRaw !== undefined
                        ? normalizeStalkerEntityId(selectedIdRaw)
                        : undefined;
                // serialSeasonsResource fetches regular-series seasons
                // (get_ordered_list&type=series) whenever selectedSerialId
                // changes. Items with embedded series[] episodes or the
                // Ministra is_series flag resolve their episodes elsewhere,
                // so only a plain type=series selection may carry the id —
                // anything else would fire a wasted portal request on every
                // detail open.
                const contentType = store.selectedContentType();
                const isRegularSeries =
                    contentType === 'series' &&
                    !!selectedItem &&
                    !isStalkerSeriesItem(selectedItem);
                patchState(store, {
                    selectedVodId: selectedId,
                    selectedSerialId: isRegularSeries ? selectedId : undefined,
                    selectedItvId: selectedId,
                    selectedItem,
                });

                // Async, best-effort TMDB enrichment for VOD/series detail
                // selections. Applies via patchState (not setSelectedItem)
                // so the hook cannot recurse; live/radio items are skipped.
                if (
                    selectedItem &&
                    (contentType === 'vod' || contentType === 'series')
                ) {
                    void enrichStalkerSelectionWithTmdb(
                        store,
                        tmdbEnrichment,
                        selectedItem,
                        stalkerSelectionMediaType(selectedItem, contentType),
                        (enriched) =>
                            patchState(store, { selectedItem: enriched })
                    );
                }
            },
            clearSelectedItem() {
                patchState(store, {
                    selectedVodId: undefined,
                    selectedSerialId: undefined,
                    selectedItvId: undefined,
                    selectedItem: undefined,
                });
            },
        };
        })
    );
}
