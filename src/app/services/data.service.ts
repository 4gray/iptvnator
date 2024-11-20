export abstract class DataService {
    get isElectron(): boolean {
        return !!(window && window.process && (window.process as any).type);
    }
    get remote() {
        return null;
    }
    get ipcRenderer() {
        return null;
    }
    abstract getAppVersion(): string;
    abstract sendIpcEvent(type: string, payload?: unknown);
    abstract removeAllListeners(type: string): void;
    abstract listenOn(
        command: string,
        callback: (...args: any[]) => void
    ): void;
    abstract getAppEnvironment(): string;
}
