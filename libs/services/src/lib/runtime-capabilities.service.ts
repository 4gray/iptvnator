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

    get supportsXtreamSqliteDataSource(): boolean {
        return [
            'dbGetPlaylist',
            'dbCreatePlaylist',
            'dbUpdatePlaylist',
            'dbDeletePlaylist',
            'dbHasCategories',
            'dbGetCategories',
            'dbSaveCategories',
            'dbGetAllCategories',
            'dbUpdateCategoryVisibility',
            'dbHasContent',
            'dbGetContent',
            'dbSaveContent',
            'dbGetAppState',
            'dbSetAppState',
            'dbSearchContent',
            'dbGetFavorites',
            'dbAddFavorite',
            'dbRemoveFavorite',
            'dbIsFavorite',
            'dbGetRecentItems',
            'dbAddRecentItem',
            'dbRemoveRecentItem',
            'dbClearPlaylistRecentItems',
            'dbGetContentByXtreamId',
            'dbSavePlaybackPosition',
            'dbGetPlaybackPosition',
            'dbGetSeriesPlaybackPositions',
            'dbGetRecentPlaybackPositions',
            'dbGetAllPlaybackPositions',
            'dbClearAllPlaybackPositions',
            'dbClearPlaybackPosition',
            'dbDeleteXtreamContent',
            'dbRestoreXtreamUserData',
        ].every((methodName) => this.hasElectronMethod(methodName));
    }

    get supportsDownloads(): boolean {
        return this.hasElectronMethod('downloadsGetList');
    }

    get supportsPortalActivityStorage(): boolean {
        return [
            'dbGetRecentlyViewed',
            'dbClearRecentlyViewed',
            'dbGetAllGlobalFavorites',
            'dbGetGlobalRecentlyAdded',
            'dbAddFavorite',
            'dbRemoveFavorite',
            'dbGetFavorites',
            'dbReorderGlobalFavorites',
            'dbGetRecentItems',
            'dbAddRecentItem',
            'dbClearPlaylistRecentItems',
            'dbRemoveRecentItem',
            'dbRemoveRecentItemsBatch',
            'dbGetContentByXtreamId',
        ].every((methodName) => this.hasElectronMethod(methodName));
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

    get supportsXtreamSectionNavigation(): boolean {
        return this.isElectron;
    }

    hasElectronMethod(methodName: string): boolean {
        return typeof this.electronBridge?.[methodName] === 'function';
    }

    private get electronBridge(): RuntimeElectronBridge | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as RuntimeWindow).electron;
    }
}
