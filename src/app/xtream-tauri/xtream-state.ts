import { XtreamCategory } from '../../../shared/xtream-category.interface';
import { XtreamLiveStream } from '../../../shared/xtream-live-stream.interface';
import { XtreamSerieItem } from '../../../shared/xtream-serie-item.interface';
import { XtreamVodStream } from '../../../shared/xtream-vod-stream.interface';
import { GlobalSearchResult } from '../services/database.service';
import { EpgItem } from '../xtream/epg-item.interface';

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
}
