export type AndroidSettingsSection = 'server' | 'playback' | 'device';

export interface AndroidShellControls {
    readonly handheld: true;
    openDeviceSettings(): void;
    openSettingsSection?(section: AndroidSettingsSection): void;
    openExternal(): boolean;
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
