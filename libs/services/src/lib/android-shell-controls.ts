export interface AndroidShellControls {
    readonly handheld: true;
    openDeviceSettings(): void;
    openExternal(): boolean;
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
