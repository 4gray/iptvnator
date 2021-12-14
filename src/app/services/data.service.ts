export abstract class DataService {
    abstract getAppVersion(): string;
    abstract sendIpcEvent(type: string, payload?: unknown): void;
    abstract removeAllListeners(type: string): void;
    abstract listenOn(
        command: string,
        callback: (...args: any[]) => void
    ): void;
}
