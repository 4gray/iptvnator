type ElectronProcessWindow = Window & {
    process?: {
        type?: string;
    };
};

export interface ElectronRemoteProcess {
    argv: string[];
    platform:
        | 'aix'
        | 'android'
        | 'darwin'
        | 'freebsd'
        | 'haiku'
        | 'linux'
        | 'openbsd'
        | 'sunos'
        | 'win32'
        | 'cygwin'
        | 'netbsd'
        | string;
}

export interface ElectronRemote {
    app?: {
        getVersion: () => string;
    };
    process: ElectronRemoteProcess;
}

export interface PlaylistImportRecovery {
    messageKey: string;
    actionKey: string;
    run: () => void;
}

export abstract class DataService {
    /** The caller presents explicit recovery inside its own focus scope. */
    playlistImportRecovery(
        _error: unknown,
        _retry: () => void
    ): PlaylistImportRecovery | null {
        void _error;
        void _retry;
        return null;
    }
    /** Fetches a source snapshot without dispatching an import/navigation action. */
    fetchPlaylistDefinition(
        _url: string,
        _userAgent?: string
    ): Promise<import('@iptvnator/shared/interfaces').Playlist> {
        void _url;
        void _userAgent;
        return Promise.reject(new Error('Playlist fetching is unavailable'));
    }
    get isElectron(): boolean {
        const currentWindow = window as ElectronProcessWindow;
        return Boolean(currentWindow.process?.type);
    }
    get remote(): ElectronRemote | null {
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
