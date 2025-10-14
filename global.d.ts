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
