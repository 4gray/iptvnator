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
            setUserAgent: (userAgent: string, referer?: string) => void;
            openInMpv: (
                url: string,
                path: string,
                title: string,
                userAgent: string,
                referer?: string,
                origin?: string
            ) => void;
            openInVlc: (
                url: string,
                path: string,
                title: string,
                userAgent: string,
                referer?: string,
                origin?: string
            ) => void;
            autoUpdatePlaylists: (playlists: Playlist[]) => Promise<Playlist[]>;
            fetchEpg: (urls: string[]) => Promise<any>;
            getChannelPrograms: (channelId: string) => Promise<any>;
            updateSettings: (settings: any) => Promise<void>;
            setMpvPlayerPath: (mpvPlayerPath: string) => Promise<void>;
            setVlcPlayerPath: (vlcPlayerPath: string) => Promise<void>;
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
