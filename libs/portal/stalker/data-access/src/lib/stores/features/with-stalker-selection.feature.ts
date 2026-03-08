import { computed } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { StalkerVodSource } from '../../models';
import { normalizeStalkerEntityId } from '../../stalker-vod.utils';

/**
 * Selection/pagination/search feature state.
 */
export interface StalkerSelectionState {
    selectedContentType: 'vod' | 'itv' | 'series';
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
        withMethods((store) => ({
            setSelectedContentType(type: 'vod' | 'itv' | 'series') {
                patchState(store, { selectedContentType: type });
            },
            setSelectedCategory(id: string | number | null) {
                patchState(store, {
                    selectedCategoryId:
                        id !== null && id !== undefined ? String(id) : null,
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
                patchState(store, { limit });
            },
            setPage(page: number) {
                patchState(store, { page });
            },
            setSearchPhrase(phrase: string) {
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
                patchState(store, {
                    selectedVodId: selectedId,
                    selectedSerialId: selectedId,
                    selectedItvId: selectedId,
                    selectedItem,
                });
            },
            clearSelectedItem() {
                patchState(store, {
                    selectedVodId: undefined,
                    selectedSerialId: undefined,
                    selectedItvId: undefined,
                    selectedItem: undefined,
                });
            },
            /** getters */
            getSelectedCategory: computed(() => {
                const storeAny = store as any;
                const categoryId = store.selectedCategoryId();
                if (!categoryId) {
                    return {
                        id: 0,
                        category_name: 'All Items',
                        type: store.selectedContentType(),
                    };
                }

                // Get categories based on content type
                const contentType = store.selectedContentType();
                let categories: any[] = [];
                const readCategories = (
                    getterName:
                        | 'vodCategories'
                        | 'seriesCategories'
                        | 'itvCategories'
                ) =>
                    typeof storeAny[getterName] === 'function'
                        ? storeAny[getterName]()
                        : [];
                if (contentType === 'vod') {
                    categories = readCategories('vodCategories');
                } else if (contentType === 'series') {
                    categories = readCategories('seriesCategories');
                } else if (contentType === 'itv') {
                    categories = readCategories('itvCategories');
                }

                return (
                    categories.find(
                        (c: any) => String(c.category_id) === String(categoryId)
                    ) || {
                        category_id: categoryId,
                        category_name: '',
                        type: contentType,
                    }
                );
            }),
        }))
    );
}
