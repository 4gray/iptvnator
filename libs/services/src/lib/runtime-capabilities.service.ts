import { Injectable } from '@angular/core';

export type RuntimeEnvironment = 'electron' | 'pwa';

type RuntimeElectronBridge = Record<string, unknown>;

type RuntimeWindow = Window & {
    electron?: RuntimeElectronBridge;
};

const playbackPositionStorageMethods = [
    'dbSavePlaybackPosition',
    'dbGetPlaybackPosition',
    'dbGetSeriesPlaybackPositions',
    'dbGetRecentPlaybackPositions',
    'dbGetAllPlaybackPositions',
    'dbClearAllPlaybackPositions',
    'dbClearPlaybackPosition',
];

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
        return (
            this.supportsEpgImport &&
            this.supportsEpgProgramLookup &&
            this.supportsEpgSourceFreshness &&
            this.supportsEpgDataManagement &&
            this.supportsEpgChannelBrowser &&
            this.supportsEpgProgramSearch
        );
    }

    get supportsEpgImport(): boolean {
        return this.hasElectronMethod('fetchEpg');
    }

    get supportsEpgProgress(): boolean {
        return this.hasElectronMethod('onEpgProgress');
    }

    get supportsEpgProgramLookup(): boolean {
        return this.hasElectronMethod('getChannelPrograms');
    }

    get supportsEpgCurrentProgramBatch(): boolean {
        return this.hasElectronMethod('getCurrentProgramsBatch');
    }

    get supportsEpgChannelMetadata(): boolean {
        return this.hasElectronMethod('getEpgChannelMetadata');
    }

    get supportsEpgSourceFreshness(): boolean {
        return this.hasElectronMethod('checkEpgFreshness');
    }

    get supportsEpgDataManagement(): boolean {
        return (
            this.hasElectronMethod('forceFetchEpg') &&
            this.hasElectronMethod('clearEpgData')
        );
    }

    get supportsEpgChannelBrowser(): boolean {
        return this.hasElectronMethod('getEpgChannelsByRange');
    }

    get supportsEpgProgramSearch(): boolean {
        return this.hasElectronMethod('searchEpgPrograms');
    }

    get supportsSqlite(): boolean {
        return [
            'dbDeleteAllPlaylists',
            'dbDeletePlaylist',
            'dbGetAppPlaylist',
            'dbGetAppPlaylists',
            'dbGetAppState',
            'dbSetAppState',
            'dbUpsertAppPlaylist',
            'dbUpsertAppPlaylists',
        ].every((methodName) => this.hasElectronMethod(methodName));
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
            ...playbackPositionStorageMethods,
            'dbDeleteXtreamContent',
            'dbRestoreXtreamUserData',
        ].every((methodName) => this.hasElectronMethod(methodName));
    }

    get supportsPlaybackPositionStorage(): boolean {
        return playbackPositionStorageMethods.every((methodName) =>
            this.hasElectronMethod(methodName)
        );
    }

    get supportsPlaybackPositionUpdates(): boolean {
        return this.hasElectronMethod('onPlaybackPositionUpdate');
    }

    get supportsDownloads(): boolean {
        return [
            'downloadsStart',
            'downloadsCancel',
            'downloadsRetry',
            'downloadsRemove',
            'downloadsGetList',
            'downloadsGet',
            'downloadsGetDefaultFolder',
            'downloadsSelectFolder',
            'downloadsRevealFile',
            'downloadsPlayFile',
            'downloadsClearCompleted',
            'onDownloadsUpdate',
        ].every((methodName) => this.hasElectronMethod(methodName));
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

    get supportsAppStateStorage(): boolean {
        return ['dbGetAppState', 'dbSetAppState'].every((methodName) =>
            this.hasElectronMethod(methodName)
        );
    }

    get supportsStalkerPlaylistSqliteSync(): boolean {
        return ['dbGetPlaylist', 'dbCreatePlaylist'].every((methodName) =>
            this.hasElectronMethod(methodName)
        );
    }

    get supportsPlaylistRefresh(): boolean {
        return [
            'refreshPlaylist',
            'cancelPlaylistRefresh',
            'onPlaylistRefreshEvent',
        ].every((methodName) => this.hasElectronMethod(methodName));
    }

    get supportsManagedExternalPlayers(): boolean {
        return ['openInMpv', 'openInVlc'].every((methodName) =>
            this.hasElectronMethod(methodName)
        );
    }

    get supportsExternalPlayerPathSettings(): boolean {
        return ['setMpvPlayerPath', 'setVlcPlayerPath'].every((methodName) =>
            this.hasElectronMethod(methodName)
        );
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
        return (
            this.isPwa ||
            this.supportsXtreamSqliteDataSource ||
            this.hasElectronMethod('xtreamRequest')
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
