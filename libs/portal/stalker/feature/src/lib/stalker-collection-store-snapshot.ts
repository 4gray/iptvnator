import {
    StalkerContentType,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { Playlist } from '@iptvnator/shared/interfaces';

type StalkerStoreInstance = InstanceType<typeof StalkerStore>;

export interface StalkerCollectionStateSnapshot {
    currentPlaylist: Playlist | undefined;
    selectedContentType: StalkerContentType;
    selectedCategoryId: string | null | undefined;
    selectedItem: unknown;
}

/**
 * A collection detail renders an item that belongs to some other portal, so it
 * has to repoint the shared store at that playlist. Capture the caller's
 * selection on mount and hand it back on teardown, or returning to the list
 * leaves the store pointing at the foreign portal.
 */
export function captureStalkerCollectionStoreState(
    store: StalkerStoreInstance
): StalkerCollectionStateSnapshot {
    return {
        currentPlaylist:
            (store.currentPlaylist() as Playlist | undefined) ?? undefined,
        selectedContentType: store.selectedContentType(),
        selectedCategoryId: store.selectedCategoryId(),
        selectedItem: store.selectedItem(),
    };
}

export function restoreStalkerCollectionStoreState(
    store: StalkerStoreInstance,
    snapshot: StalkerCollectionStateSnapshot
): void {
    void store.setCurrentPlaylist(snapshot.currentPlaylist);
    store.setSelectedContentType(snapshot.selectedContentType);
    store.setSelectedCategory(snapshot.selectedCategoryId ?? null);
    store.setSelectedItem(snapshot.selectedItem as never);
}
