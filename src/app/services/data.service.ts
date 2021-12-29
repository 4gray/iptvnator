export abstract class DataService {
    get isElectron(): boolean {
        return !!(window && window.process && (window.process as any).type);
    }
    abstract getAppVersion(): string;
    abstract sendIpcEvent(type: string, payload?: unknown): void;
    abstract removeAllListeners(type: string): void;
    abstract listenOn(
        command: string,
        callback: (...args: any[]) => void
    ): void;
}
