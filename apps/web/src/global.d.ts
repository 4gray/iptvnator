import 'jest-extended';
import { Playlist } from 'shared-interfaces';

declare module 'video.js' {
    export interface VideoJsPlayer {
        hlsQualitySelector(options?: any): void;
    }
}

declare global {
    interface Window {
        electron: {
            getAppVersion: () => Promise<string>;
            platform: string;
            fetchPlaylistByUrl: (url: string) => Promise<Playlist>;
        };
    }
}
