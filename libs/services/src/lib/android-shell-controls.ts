export type AndroidSettingsSection = 'server' | 'playback' | 'device';

export interface AndroidShellControls {
    readonly handheld: true;
    openDeviceSettings(): void;
    openSettingsSection?(section: AndroidSettingsSection): void;
    openExternal(): boolean;
}

export interface AndroidLibraryControls {
    libraryConnection(): {
        origin: string;
        savedOrigin: string;
        approvalOrigin?: string;
        canScanQr: boolean;
    };
    scanLibraryQr(): void;
    disconnectLibrary(): void;
    pairLibrary(address: string, approvalAddress: string): void;
    connectLibrary(address: string): void;
}

export function getAndroidLibraryControls():
    AndroidLibraryControls | undefined {
    const shell = getAndroidShellControls() as
        (AndroidShellControls & Partial<AndroidLibraryControls>) | undefined;
    if (
        shell &&
        typeof shell.libraryConnection === 'function' &&
        typeof shell.scanLibraryQr === 'function' &&
        typeof shell.disconnectLibrary === 'function' &&
        typeof shell.pairLibrary === 'function' &&
        typeof shell.connectLibrary === 'function'
    )
        return shell as AndroidLibraryControls;
    return undefined;
}

type AndroidSettingsControls = AndroidShellControls &
    Required<Pick<AndroidShellControls, 'openSettingsSection'>>;

export function getAndroidSettingsControls():
    AndroidSettingsControls | undefined {
    const shell = getAndroidShellControls();
    return typeof shell?.openSettingsSection === 'function'
        ? (shell as AndroidSettingsControls)
        : undefined;
}

export function getAndroidShellControls(): AndroidShellControls | undefined {
    if (typeof window === 'undefined') return undefined;
    const shell = (window as Window & { __tvShell?: AndroidShellControls })
        .__tvShell;
    return shell?.handheld === true &&
        typeof shell.openDeviceSettings === 'function' &&
        typeof shell.openExternal === 'function'
        ? shell
        : undefined;
}
