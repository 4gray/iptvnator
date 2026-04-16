import { Store } from '@ngrx/store';
import { PlaylistActions } from 'm3u-state';
import { PlaylistMeta, StalkerPortalItem } from 'shared-interfaces';
import { normalizeStalkerEntityId } from '../../stalker-vod.utils';
import {
    StalkerContentType,
    StalkerRecentlyViewedItem,
} from '../stalker-store.contracts';

export type StalkerCollectionPayload = StalkerPortalItem & {
    cmd?: string;
    cover?: string;
    id?: string | number;
    stream_id?: string | number;
    title?: string;
};

export function resolveStalkerCategoryId(
    value: unknown,
    fallback: string
): string {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
}

export function getStalkerSeriesRecentMetadata(
    selectedContentType: StalkerContentType
): {
    category_id?: 'series';
    is_series?: true;
} {
    if (selectedContentType !== 'series') {
        return {};
    }

    return {
        category_id: 'series',
        is_series: true,
    };
}

export function buildStalkerRecentlyViewedPayload(
    item: StalkerCollectionPayload,
    selectedContentType: StalkerContentType
): StalkerRecentlyViewedItem {
    return {
        ...item,
        category_id: resolveStalkerCategoryId(
            item.category_id,
            selectedContentType
        ),
        ...getStalkerSeriesRecentMetadata(selectedContentType),
        added_at: Date.now(),
        id: normalizeStalkerEntityId(item.id ?? item.stream_id ?? ''),
        title: item.title ?? item.name ?? item.o_name ?? '',
    };
}

export function dispatchStalkerPlaylistMetaUpdate(
    ngrxStore: Store,
    playlistId: string | undefined,
    changes: Pick<PlaylistMeta, 'favorites' | 'recentlyViewed'>
): void {
    if (!playlistId) {
        return;
    }

    ngrxStore.dispatch(
        PlaylistActions.updatePlaylistMeta({
            playlist: {
                _id: playlistId,
                ...changes,
            } as PlaylistMeta,
        })
    );
}
