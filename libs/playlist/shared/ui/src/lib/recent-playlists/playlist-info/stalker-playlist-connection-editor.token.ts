import { InjectionToken } from '@angular/core';
import type {
    PlaylistMeta,
    PlaylistMetaUpdate,
} from '@iptvnator/shared/interfaces';

export const STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS = {
    RESOLVED: 'resolved',
    AUTH_REJECTED: 'auth-rejected',
    UNREACHABLE: 'unreachable',
} as const;

export interface StalkerPlaylistConnectionResolved {
    status: typeof STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED;
    playlist: PlaylistMetaUpdate;
}

export interface StalkerPlaylistConnectionAuthRejected {
    status: typeof STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.AUTH_REJECTED;
    message: string;
}

export interface StalkerPlaylistConnectionUnreachable {
    status: typeof STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.UNREACHABLE;
    message: string;
}

interface StalkerPlaylistConnectionResultMap {
    resolved: StalkerPlaylistConnectionResolved;
    'auth-rejected': StalkerPlaylistConnectionAuthRejected;
    unreachable: StalkerPlaylistConnectionUnreachable;
}

export type StalkerPlaylistConnectionResult =
    StalkerPlaylistConnectionResultMap[keyof StalkerPlaylistConnectionResultMap];

export interface StalkerResolvedConnectionApplyOptions {
    /** Merge only connection/session fields into the current persisted row. */
    preserveCurrentMetadata?: boolean;
}

export interface StalkerPlaylistConnectionEditor {
    resolveConnection(
        playlist: PlaylistMeta,
        sourcePlaylist?: PlaylistMeta
    ): Promise<StalkerPlaylistConnectionResult>;
    /** Atomically persists a resolved edit, then synchronizes in-run state. */
    applyResolvedConnection(
        playlist: PlaylistMetaUpdate,
        options?: StalkerResolvedConnectionApplyOptions
    ): Promise<PlaylistMetaUpdate>;
}

export const STALKER_PLAYLIST_CONNECTION_EDITOR =
    new InjectionToken<StalkerPlaylistConnectionEditor>(
        'STALKER_PLAYLIST_CONNECTION_EDITOR'
    );
