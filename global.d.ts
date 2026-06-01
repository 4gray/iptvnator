import 'jest-extended';
import type {
    ElectronBridgeApi,
    ElectronBridgeDbOperationEvent,
    ElectronDownloadItem,
} from './libs/shared/interfaces/src/lib/electron-api.interface';

declare module 'video.js' {
    export interface VideoJsPlayer {
        hlsQualitySelector(options?: Record<string, unknown>): void;
    }
}

declare global {
    type ElectronDbOperationEvent = ElectronBridgeDbOperationEvent;

    interface Window {
        __IPTVNATOR_CONFIG__?: {
            BACKEND_URL?: string;
        };
        electron: ElectronBridgeApi;
        process: NodeJS.Process;
        require: NodeRequire;
    }

    /** Download item from the database */
    type DownloadItem = ElectronDownloadItem;
}

// SystemJS module definition
declare const nodeModule: NodeModule;
interface NodeModule {
    id: string;
}
