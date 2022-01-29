import { ipcRenderer } from 'electron';
export abstract class DataService {
    get isElectron(): boolean {
        return !!(window && window.process && (window.process as any).type);
    }
    get remote() {
        return this.isElectron ? window.require('@electron/remote') : null;
    }
    get ipcRenderer(): typeof ipcRenderer {
        return this.isElectron ? window.require('electron').ipcRenderer : null;
    }
    abstract getAppVersion(): string;
    abstract sendIpcEvent(type: string, payload?: unknown): void;
    abstract removeAllListeners(type: string): void;
    abstract listenOn(
        command: string,
        callback: (...args: any[]) => void
    ): void;
}
