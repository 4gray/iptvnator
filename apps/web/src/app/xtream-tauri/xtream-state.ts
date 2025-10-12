import { GlobalSearchResult } from '../../../../../libs/services/src/lib/database.service';
import { EpgItem } from '../../../../../libs/shared/interfaces/src/lib/epg-item.interface';
import { XtreamSerieItem } from '../../../../../libs/shared/interfaces/src/lib/xtream-serie-item.interface';
import { XtreamCategory } from '../../shared/xtream-category.interface';
import { XtreamLiveStream } from '../../shared/xtream-live-stream.interface';
import { XtreamVodStream } from '../../shared/xtream-vod-stream.interface';

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
