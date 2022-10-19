import { ID } from '@datorama/akita';

/**
 * An interface that describe the possible states of the playlist update/refresh process
 */
export enum PlaylistUpdateState {
    UPDATED,
    IN_PROGRESS,
    NOT_UPDATED,
}

/**
 * Describes playlist interface
 */
export interface Playlist {
    id: ID;
    _id: string;
    title: string;
    filename: string;
    playlist: any;
    importDate: string;
    lastUsage: string;
    favorites: string[];
    count: number;
    url?: string;
    userAgent?: string;
    filePath?: string;
    autoRefresh: boolean;
    updateDate?: number;
    updateState?: PlaylistUpdateState;
    position?: number;
    isTemporary?: boolean;
}
