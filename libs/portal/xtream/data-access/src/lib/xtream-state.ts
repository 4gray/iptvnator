import { GlobalSearchResult } from '@iptvnator/services';
import {
    EpgItem,
    XtreamCategory,
    XtreamLiveStream,
    XtreamSerieItem,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import {
    XtreamContentItem,
    XtreamPlaylistData,
} from './data-sources/xtream-data-source.interface';

export type ContentType = 'live' | 'vod' | 'series';
export type XtreamCachedContentScope =
    | ContentType
    | 'search'
    | 'recently-added';
export type XtreamContentLoadState = 'idle' | 'loading' | 'ready' | 'error';
export type XtreamContentLoadStateByType = Record<
    ContentType,
    XtreamContentLoadState
>;

export type PortalStatusType =
    | 'active'
    | 'inactive'
    | 'expired'
    | 'unavailable';

export type XtreamContentInitBlockReason =
    | 'cancelled'
    | 'expired'
    | 'inactive'
    | 'unavailable'
    | 'error';

export interface XtreamPortalStatus {
    status: 'active' | 'inactive' | 'expired' | 'unavailable';
    message?: string;
}

export interface XtreamState {
    isLoadingCategories: boolean;
    isLoadingContent: boolean;
    isImporting: boolean;
    contentLoadStateByType: XtreamContentLoadStateByType;
    liveCategories: XtreamCategory[];
    vodCategories: XtreamCategory[];
    serialCategories: XtreamCategory[];
    liveStreams: XtreamLiveStream[];
    vodStreams: XtreamVodStream[];
    serialStreams: XtreamSerieItem[];
    page: number;
    limit: number;
    selectedCategoryId: number | null;
    searchResults: XtreamContentItem[];
    selectedContentType: ContentType;
    selectedItem: unknown | null;
    importCount: number;
    itemsToImport: number;
    currentPlaylist: XtreamPlaylistData | null;
    epgItems: EpgItem[];
    hideExternalInfoDialog: boolean;
    portalStatus: PortalStatusType;
    contentInitBlockReason: XtreamContentInitBlockReason | null;
    globalSearchResults: GlobalSearchResult[];
    streamUrl: string;
    playlistId: string | null;
}
