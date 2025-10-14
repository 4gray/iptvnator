import { GlobalSearchResult } from 'services';
import {
    EpgItem,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from 'shared-interfaces';

export type ContentType = 'live' | 'vod' | 'series';

export type PortalStatusType =
    | 'active'
    | 'inactive'
    | 'expired'
    | 'unavailable';

export interface XtreamPortalStatus {
    status: 'active' | 'inactive' | 'expired' | 'unavailable';
    message?: string;
}

export interface XtreamState {
    isLoadingCategories: boolean;
    isLoadingContent: boolean;
    isImporting: boolean;
    liveCategories: XtreamCategory[];
    vodCategories: XtreamCategory[];
    serialCategories: XtreamCategory[];
    liveStreams: XtreamLiveStream[];
    vodStreams: XtreamVodStream[];
    serialStreams: XtreamSerieItem[];
    page: number;
    limit: number;
    selectedCategoryId: number | null;
    searchResults: any[];
    selectedContentType: ContentType;
    selectedItem: any | null;
    importCount: number;
    itemsToImport: number;
    currentPlaylist: any | null;
    epgItems: EpgItem[];
    hideExternalInfoDialog: boolean;
    portalStatus: PortalStatusType;
    globalSearchResults: GlobalSearchResult[];
    streamUrl: string;
}
