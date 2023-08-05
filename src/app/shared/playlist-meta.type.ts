import { Playlist } from '../../../shared/playlist.interface';

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
>;
