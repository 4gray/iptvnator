import { Playlist } from './playlist.interface';

export type PlaylistMeta = Pick<
    Playlist,
    | 'count'
    | 'title'
    | 'filename'
    | '_id'
    | 'url'
    | 'importDate'
    | 'userAgent'
    | 'referrer'
    | 'origin'
    | 'filePath'
    | 'epgUrls'
    | 'detectedEpgUrls'
    | 'manualEpgUrls'
    | 'disabledEpgUrls'
    | 'updateDate'
    | 'updateState'
    | 'position'
    | 'autoRefresh'
    | 'favorites'
    | 'serverUrl'
    | 'username'
    | 'password'
    | 'macAddress'
    | 'hiddenGroupTitles'
    | 'portalUrl'
    | 'recentlyViewed'
    | 'serverTimezone'
    | 'isFullStalkerPortal'
    | 'stalkerSerialNumber'
    | 'stalkerDeviceId1'
    | 'stalkerDeviceId2'
    | 'stalkerSignature1'
    | 'stalkerSignature2'
>;

export interface StalkerPlaylistSessionMetadata {
    stalkerToken: string;
    stalkerSessionIdentity?: string;
    stalkerWatchdogTimeout?: number;
    stalkerTimeslot?: number;
    stalkerAccountInfo?: Playlist['stalkerAccountInfo'];
}

/**
 * Metadata update accepted by the persistence boundary.
 *
 * `stalkerSessionPatch` is transient: absence preserves the negotiated
 * session, `null` clears it, and an object fully replaces it. The patch is
 * projected onto the existing flat playlist fields and is never persisted as
 * its own database or backup property.
 */
export interface PlaylistMetaUpdate extends PlaylistMeta {
    stalkerSessionPatch?: StalkerPlaylistSessionMetadata | null;
}
