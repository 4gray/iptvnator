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

export interface StalkerPlaylistConnectionEditor {
    resolveConnection(
        playlist: PlaylistMeta
    ): Promise<StalkerPlaylistConnectionResult>;
    /** Synchronizes in-run Stalker state after the resolved update dispatches. */
    applyResolvedConnection(playlist: PlaylistMetaUpdate): Promise<void>;
}

export const STALKER_PLAYLIST_CONNECTION_EDITOR =
    new InjectionToken<StalkerPlaylistConnectionEditor>(
        'STALKER_PLAYLIST_CONNECTION_EDITOR'
    );
