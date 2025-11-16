import 'jest-extended';
import { Playlist } from './libs/shared/interfaces/src/lib/playlist.interface';

declare module 'video.js' {
    export interface VideoJsPlayer {
        hlsQualitySelector(options?: Record<string, unknown>): void;
    }
}

declare global {
    interface Window {
        electron: {
            getAppVersion: () => Promise<string>;
            platform: string;
            fetchPlaylistByUrl: (
                url: string,
                title?: string
            ) => Promise<Playlist>;
            updatePlaylistFromFilePath: (
                filePath: string,
                title: string
            ) => Promise<Playlist>;
            openPlaylistFromFile: () => Promise<Playlist>;
            saveFileDialog: (
                defaultPath: string,
                filters?: { name: string; extensions: string[] }[]
            ) => Promise<string | null>;
            writeFile: (
                filePath: string,
                content: string
            ) => Promise<{ success: boolean }>;
            setUserAgent: (userAgent: string, referer?: string) => void;
            openInMpv: (
                url: string,
                title: string,
                userAgent: string,
                referer?: string,
                origin?: string
            ) => void;
            openInVlc: (
                url: string,
                title: string,
                userAgent: string,
                referer?: string,
                origin?: string
            ) => void;
            autoUpdatePlaylists: (playlists: Playlist[]) => Promise<Playlist[]>;
            fetchEpg: (
                urls: string[]
            ) => Promise<{ success: boolean; message?: string }>;
            getChannelPrograms: (channelId: string) => Promise<any>;
            getEpgChannels: () => Promise<any>;
            getEpgChannelsByRange: (
                skip: number,
                limit: number
            ) => Promise<any>;
            forceFetchEpg: (
                url: string
            ) => Promise<{ success: boolean; message?: string }>;
            updateSettings: (settings: any) => Promise<void>;
            setMpvPlayerPath: (mpvPlayerPath: string) => Promise<void>;
            setVlcPlayerPath: (vlcPlayerPath: string) => Promise<void>;
            stalkerRequest: (payload: {
                url: string;
                macAddress: string;
                params: Record<string, string>;
            }) => Promise<any>;
            xtreamRequest: (payload: {
                url: string;
                params: Record<string, string>;
            }) => Promise<{ payload: any; action: string }>;
            // Database operations
            dbCreatePlaylist: (playlist: any) => Promise<{ success: boolean }>;
            dbGetPlaylist: (playlistId: string) => Promise<any>;
            dbUpdatePlaylist: (
                playlistId: string,
                updates: any
            ) => Promise<{ success: boolean }>;
            dbDeletePlaylist: (
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbDeleteXtreamContent: (
                playlistId: string
            ) => Promise<{
                success: boolean;
                favoritedXtreamIds: number[];
                recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[];
            }>;
            dbRestoreXtreamUserData: (
                playlistId: string,
                favoritedXtreamIds: number[],
                recentlyViewedXtreamIds: { xtreamId: number; viewedAt: string }[]
            ) => Promise<{ success: boolean }>;
            dbHasCategories: (
                playlistId: string,
                type: string
            ) => Promise<boolean>;
            dbGetCategories: (
                playlistId: string,
                type: string
            ) => Promise<any[]>;
            dbSaveCategories: (
                playlistId: string,
                categories: any[],
                type: string
            ) => Promise<{ success: boolean }>;
            dbHasContent: (
                playlistId: string,
                type: string
            ) => Promise<boolean>;
            dbGetContent: (playlistId: string, type: string) => Promise<any[]>;
            dbSaveContent: (
                playlistId: string,
                streams: any[],
                type: string
            ) => Promise<{ success: boolean; count: number }>;
            dbSearchContent: (
                playlistId: string,
                searchTerm: string,
                types: string[]
            ) => Promise<any[]>;
            dbGlobalSearch: (
                searchTerm: string,
                types: string[]
            ) => Promise<any[]>;
            dbGetRecentlyViewed: () => Promise<any[]>;
            dbClearRecentlyViewed: () => Promise<{ success: boolean }>;
            // Favorites
            dbAddFavorite: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbRemoveFavorite: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbIsFavorite: (
                contentId: number,
                playlistId: string
            ) => Promise<boolean>;
            dbGetFavorites: (playlistId: string) => Promise<any[]>;
            // Recently viewed (playlist-specific)
            dbGetRecentItems: (playlistId: string) => Promise<any[]>;
            dbAddRecentItem: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbClearPlaylistRecentItems: (
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbRemoveRecentItem: (
                contentId: number,
                playlistId: string
            ) => Promise<{ success: boolean }>;
            dbGetContentByXtreamId: (
                xtreamId: number,
                playlistId: string
            ) => Promise<any | null>;
            // Remote control
            onChannelChange?: (
                callback: (data: { direction: 'up' | 'down' }) => void
            ) => void;
        };
        process: NodeJS.Process;
        require: NodeRequire;
    }
}

// SystemJS module definition
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}
