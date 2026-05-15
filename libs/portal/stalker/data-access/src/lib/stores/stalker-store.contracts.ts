import { PlaylistMeta, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import {
    StalkerCategoryItem,
    StalkerContentItem,
    StalkerSeason,
    StalkerVodSeriesSeason,
    StalkerVodSource,
} from '../models';

export type StalkerContentType = 'vod' | 'series' | 'itv' | 'radio';

export interface ResourceState<T> {
    value(): T;
    isLoading(): boolean;
    error(): unknown;
}

export interface StalkerPortalStoreContract {
    currentPlaylist(): PlaylistMeta | undefined;
}

export interface StalkerSelectionStoreContract {
    selectedContentType(): StalkerContentType;
    selectedCategoryId(): string | null | undefined;
    selectedVodId(): string | undefined;
    selectedSerialId(): string | undefined;
    selectedItvId(): string | undefined;
    limit(): number;
    page(): number;
    searchPhrase(): string;
    selectedItem(): StalkerVodSource | null | undefined;
}

export interface StalkerCategorySliceContract {
    vodCategories(): StalkerCategoryItem[];
    seriesCategories(): StalkerCategoryItem[];
    itvCategories(): StalkerCategoryItem[];
    radioCategories(): StalkerCategoryItem[];
}

export interface StalkerContentFeatureStoreContract
    extends
        StalkerPortalStoreContract,
        StalkerSelectionStoreContract,
        StalkerCategorySliceContract {
    getContentResource: ResourceState<StalkerContentItem[]>;
    categoryResource: ResourceState<StalkerCategoryItem[]>;
}

export interface StalkerSeriesFeatureStoreContract
    extends
        StalkerPortalStoreContract,
        Pick<
            StalkerSelectionStoreContract,
            'selectedContentType' | 'selectedItem' | 'selectedSerialId'
        > {
    serialSeasonsResource: ResourceState<StalkerSeason[]>;
    vodSeriesSeasonsResource: ResourceState<StalkerVodSeriesSeason[]>;
}

export interface StalkerRecentCallbackStoreContract {
    addToRecentlyViewed?: (item: StalkerRecentlyViewedItem) => void;
}

export type StalkerRecentlyViewedItem = StalkerPortalItem & {
    id: string | number;
    title: string;
};

export interface StalkerPlayerFeatureStoreContract
    extends
        StalkerPortalStoreContract,
        Pick<
            StalkerSelectionStoreContract,
            'selectedContentType' | 'selectedItem'
        >,
        StalkerRecentCallbackStoreContract {}

export interface StalkerEpgFeatureStoreContract
    extends
        StalkerPortalStoreContract,
        Pick<StalkerSelectionStoreContract, 'selectedItvId'> {}
