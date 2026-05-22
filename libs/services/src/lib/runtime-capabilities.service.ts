import { Injectable } from '@angular/core';

export type RuntimeEnvironment = 'electron' | 'pwa';

type RuntimeElectronBridge = Record<string, unknown>;

type RuntimeWindow = Window & {
    electron?: RuntimeElectronBridge;
};

@Injectable({ providedIn: 'root' })
export class RuntimeCapabilitiesService {
    get environment(): RuntimeEnvironment {
        return this.isElectron ? 'electron' : 'pwa';
    }

    get isElectron(): boolean {
        return !!this.electronBridge;
    }

    get isPwa(): boolean {
        return !this.isElectron;
    }

    get platform(): string | undefined {
        const platform = this.electronBridge?.['platform'];
        return typeof platform === 'string' ? platform : undefined;
    }

    get isMacOS(): boolean {
        return this.platform === 'darwin';
    }

    get supportsEpg(): boolean {
        return this.isElectron;
    }

    get supportsSqlite(): boolean {
        return (
            this.hasElectronMethod('dbGetAppPlaylists') &&
            this.hasElectronMethod('dbUpsertAppPlaylist') &&
            this.hasElectronMethod('dbGetAppState') &&
            this.hasElectronMethod('dbSetAppState')
        );
    }

    get supportsDownloads(): boolean {
        return this.hasElectronMethod('downloadsGetList');
    }

    get supportsPortalActivityStorage(): boolean {
        return (
            this.hasElectronMethod('dbGetRecentlyViewed') &&
            this.hasElectronMethod('dbGetAllGlobalFavorites') &&
            this.hasElectronMethod('dbGetGlobalRecentlyAdded') &&
            this.hasElectronMethod('dbRemoveRecentItem') &&
            this.hasElectronMethod('dbRemoveFavorite')
        );
    }

    get supportsManagedExternalPlayers(): boolean {
        return this.isElectron;
    }

    get supportsEmbeddedMpv(): boolean {
        return this.hasElectronMethod('prepareEmbeddedMpv');
    }

    get supportsDesktopFileSave(): boolean {
        return (
            this.hasElectronMethod('saveFileDialog') &&
            this.hasElectronMethod('writeFile')
        );
    }

    get supportsRemoteControl(): boolean {
        return (
            this.hasElectronMethod('updateRemoteControlStatus') &&
            this.hasElectronMethod('onChannelChange') &&
            this.hasElectronMethod('onRemoteControlCommand')
        );
    }

    private hasElectronMethod(methodName: string): boolean {
        return typeof this.electronBridge?.[methodName] === 'function';
    }

    private get electronBridge(): RuntimeElectronBridge | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as RuntimeWindow).electron;
    }
}
