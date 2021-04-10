import { ID } from '@datorama/akita';

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
}
