type ElectronProcessWindow = Window & {
    process?: {
        type?: string;
    };
};

export abstract class DataService {
    get isElectron(): boolean {
        const currentWindow = window as ElectronProcessWindow;
        return Boolean(currentWindow.process?.type);
    }
    get remote() {
        return null;
    }
    get ipcRenderer() {
        return null;
    }
    abstract getAppVersion(): string;
    abstract sendIpcEvent<T = unknown>(
        type: string,
        payload?: unknown
    ): T | Promise<T>;
    abstract removeAllListeners(type: string): void;
    abstract listenOn(
        command: string,
        callback: (...args: unknown[]) => void
    ): void;
    abstract getAppEnvironment(): string;
}
