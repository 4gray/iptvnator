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
    | 'filePath'
    | 'updateDate'
    | 'updateState'
    | 'position'
    | 'autoRefresh'
    | 'favorites'
    | 'serverUrl'
    | 'username'
    | 'password'
    | 'macAddress'
    | 'portalUrl'
    | 'recentlyViewed'
    | 'stalkerSerialNumber'
    | 'stalkerDeviceId1'
    | 'stalkerDeviceId2'
    | 'stalkerSignature1'
    | 'stalkerSignature2'
>;
