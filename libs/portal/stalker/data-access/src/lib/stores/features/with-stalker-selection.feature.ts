import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { StalkerVodSource } from '../../models';
import { normalizeStalkerEntityId } from '../../stalker-vod.utils';
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
                if (store.selectedContentType() === type) {
                    return;
                }

                // Without the page reset, switching e.g. /vod -> /series with
                // the same category id ('*' on both section roots) would leave
                // page > 1 in place and make the new type's FIRST response an
                // append onto the old type's accumulated list.
                patchState(store, { selectedContentType: type, page: 0 });
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
            setPage(page: number) {
                if (store.page() === page) {
                    return;
                }

                patchState(store, { page });
            },
            /** Advances to the next portal page (infinite-scroll append). */
            nextPage() {
                patchState(store, { page: store.page() + 1 });
            },
            setSearchPhrase(phrase: string) {
                if (store.searchPhrase() === phrase) {
                    return;
                }

                // ITV search is local to each surface; keep the shared catalog pages.
                patchState(store, {
                    searchPhrase: phrase,
                    ...(store.selectedContentType() === 'itv' ? {} : { page: 0 }),
                });
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
                // (get_ordered_list&type=series) on every selectedSerialId
                // change, and it is the only episode source for a `series`
                // selection. Every other content type resolves episodes
                // elsewhere — embedded series[] and Ministra is_series items
                // are always opened as `vod` — so carrying the id there only
                // fires a portal request whose result is discarded.
                const contentType = store.selectedContentType();
                patchState(store, {
                    selectedVodId: selectedId,
                    selectedSerialId:
                        contentType === 'series' ? selectedId : undefined,
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
