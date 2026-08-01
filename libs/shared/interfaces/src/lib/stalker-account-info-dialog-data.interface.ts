import { PlaylistMeta } from './playlist-meta.type';

/**
 * Dialog input for the Stalker account-info dialog. The meta row carries the
 * portal URL, MAC address, and device identity needed for a fresh portal
 * query; the cached `stalkerAccountInfo` snapshot lives only in the full
 * playlist payload, so the dialog loads it by id.
 */
export interface StalkerAccountInfoDialogData {
    playlist: PlaylistMeta;
}
