import type {
    StalkerSearchContentType,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';

export interface StalkerGlobalSearchContext {
    term: string;
    movies: boolean;
    series: boolean;
    sources: readonly PlaylistMeta[];
    lockVersion: number;
    excludeHidden: boolean;
}

export interface StalkerGlobalSearchItem {
    readonly playlistId: string;
    readonly origin: StalkerSearchContentType;
    readonly id: string;
    readonly displayType: 'movie' | 'series';
    readonly item: StalkerVodSource;
    readonly key: string;
}

export interface StalkerGlobalSearchGroup {
    readonly playlistId: string;
    readonly playlistName: string;
    readonly origins: readonly StalkerSearchContentType[];
    readonly more: readonly StalkerSearchContentType[];
    readonly loading: boolean;
    readonly hasError: boolean;
    readonly items: readonly StalkerGlobalSearchItem[];
}
