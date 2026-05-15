import { StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { CollectionContentType } from './unified-collection-item.interface';

export interface XtreamFavoriteRow {
    readonly id: number;
    readonly category_id: number;
    readonly playlist_id: string;
    readonly playlist_name: string;
    readonly xtream_id: number;
    readonly title: string;
    readonly type: string;
    readonly poster_url?: string | null;
    readonly rating?: string | null;
    readonly added_at?: string | null;
    readonly position?: number | null;
}

export function isStalkerItem(
    v: string | StalkerPortalItem
): v is StalkerPortalItem {
    return typeof v !== 'string';
}

export function stalkerContentType(
    fav: StalkerPortalItem
): CollectionContentType {
    if (fav.movie_id) return 'movie';
    if (fav.series_id) return 'series';
    return 'live';
}

export function xtreamContentType(type: string): CollectionContentType {
    if (type === 'movie' || type === 'movies') return 'movie';
    if (type === 'series') return 'series';
    return 'live';
}
