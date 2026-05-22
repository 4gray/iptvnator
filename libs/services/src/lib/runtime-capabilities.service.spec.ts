import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

describe('RuntimeCapabilitiesService', () => {
    const testWindow = window as unknown as {
        electron?: Record<string, unknown>;
    };
    const originalElectron = testWindow.electron;

    afterEach(() => {
        testWindow.electron = originalElectron;
    });

    it('reports browser PWA capabilities when the Electron bridge is absent', () => {
        testWindow.electron = undefined;

        const service = new RuntimeCapabilitiesService();

        expect(service.environment).toBe('pwa');
        expect(service.isPwa).toBe(true);
        expect(service.isElectron).toBe(false);
        expect(service.platform).toBeUndefined();
        expect(service.isMacOS).toBe(false);
        expect(service.supportsEpg).toBe(false);
        expect(service.supportsSqlite).toBe(false);
        expect(service.supportsXtreamSqliteDataSource).toBe(false);
        expect(service.supportsDownloads).toBe(false);
        expect(service.supportsPortalActivityStorage).toBe(false);
        expect(service.supportsAppStateStorage).toBe(false);
        expect(service.supportsStalkerPlaylistSqliteSync).toBe(false);
        expect(service.supportsPlaylistRefresh).toBe(false);
        expect(service.supportsManagedExternalPlayers).toBe(false);
        expect(service.supportsExternalPlayerPathSettings).toBe(false);
        expect(service.supportsEmbeddedMpv).toBe(false);
        expect(service.supportsDesktopFileSave).toBe(false);
        expect(service.supportsRemoteControl).toBe(false);
        expect(service.supportsXtreamSectionNavigation).toBe(true);
    });

    it('reports Electron capabilities from the available preload bridge methods', () => {
        testWindow.electron = {
            platform: 'darwin',
            dbDeleteAllPlaylists: jest.fn(),
            dbDeletePlaylist: jest.fn(),
            dbGetAppPlaylist: jest.fn(),
            dbGetAppPlaylists: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
            dbGetAppState: jest.fn(),
            dbSetAppState: jest.fn(),
            dbGetRecentlyViewed: jest.fn(),
            dbClearRecentlyViewed: jest.fn(),
            dbGetAllGlobalFavorites: jest.fn(),
            dbGetGlobalRecentlyAdded: jest.fn(),
            dbAddFavorite: jest.fn(),
            dbRemoveRecentItem: jest.fn(),
            dbRemoveFavorite: jest.fn(),
            dbGetFavorites: jest.fn(),
            dbReorderGlobalFavorites: jest.fn(),
            dbGetRecentItems: jest.fn(),
            dbAddRecentItem: jest.fn(),
            dbClearPlaylistRecentItems: jest.fn(),
            dbRemoveRecentItemsBatch: jest.fn(),
            dbGetContentByXtreamId: jest.fn(),
            dbGetPlaylist: jest.fn(),
            dbCreatePlaylist: jest.fn(),
            dbUpdatePlaylist: jest.fn(),
            dbHasCategories: jest.fn(),
            dbGetCategories: jest.fn(),
            dbSaveCategories: jest.fn(),
            dbGetAllCategories: jest.fn(),
            dbUpdateCategoryVisibility: jest.fn(),
            dbHasContent: jest.fn(),
            dbGetContent: jest.fn(),
            dbSaveContent: jest.fn(),
            dbSearchContent: jest.fn(),
            dbIsFavorite: jest.fn(),
            dbSavePlaybackPosition: jest.fn(),
            dbGetPlaybackPosition: jest.fn(),
            dbGetSeriesPlaybackPositions: jest.fn(),
            dbGetRecentPlaybackPositions: jest.fn(),
            dbGetAllPlaybackPositions: jest.fn(),
            dbClearAllPlaybackPositions: jest.fn(),
            dbClearPlaybackPosition: jest.fn(),
            dbDeleteXtreamContent: jest.fn(),
            dbRestoreXtreamUserData: jest.fn(),
            downloadsStart: jest.fn(),
            downloadsCancel: jest.fn(),
            downloadsRetry: jest.fn(),
            downloadsRemove: jest.fn(),
            downloadsGetList: jest.fn(),
            downloadsGet: jest.fn(),
            downloadsGetDefaultFolder: jest.fn(),
            downloadsSelectFolder: jest.fn(),
            downloadsRevealFile: jest.fn(),
            downloadsPlayFile: jest.fn(),
            downloadsClearCompleted: jest.fn(),
            onDownloadsUpdate: jest.fn(),
            refreshPlaylist: jest.fn(),
            cancelPlaylistRefresh: jest.fn(),
            onPlaylistRefreshEvent: jest.fn(),
            openInMpv: jest.fn(),
            openInVlc: jest.fn(),
            setMpvPlayerPath: jest.fn(),
            setVlcPlayerPath: jest.fn(),
            prepareEmbeddedMpv: jest.fn(),
            saveFileDialog: jest.fn(),
            writeFile: jest.fn(),
            updateRemoteControlStatus: jest.fn(),
            onChannelChange: jest.fn(),
            onRemoteControlCommand: jest.fn(),
            xtreamRequest: jest.fn(),
            fetchEpg: jest.fn(),
            getChannelPrograms: jest.fn(),
            checkEpgFreshness: jest.fn(),
            forceFetchEpg: jest.fn(),
            clearEpgData: jest.fn(),
            getEpgChannelsByRange: jest.fn(),
            searchEpgPrograms: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.environment).toBe('electron');
        expect(service.isElectron).toBe(true);
        expect(service.isPwa).toBe(false);
        expect(service.platform).toBe('darwin');
        expect(service.isMacOS).toBe(true);
        expect(service.supportsEpg).toBe(true);
        expect(service.supportsSqlite).toBe(true);
        expect(service.supportsXtreamSqliteDataSource).toBe(true);
        expect(service.supportsDownloads).toBe(true);
        expect(service.supportsPortalActivityStorage).toBe(true);
        expect(service.supportsAppStateStorage).toBe(true);
        expect(service.supportsStalkerPlaylistSqliteSync).toBe(true);
        expect(service.supportsPlaylistRefresh).toBe(true);
        expect(service.supportsManagedExternalPlayers).toBe(true);
        expect(service.supportsExternalPlayerPathSettings).toBe(true);
        expect(service.supportsEmbeddedMpv).toBe(true);
        expect(service.supportsDesktopFileSave).toBe(true);
        expect(service.supportsRemoteControl).toBe(true);
        expect(service.supportsXtreamSectionNavigation).toBe(true);
    });

    it('keeps feature-specific capabilities false when an Electron bridge is partial', () => {
        testWindow.electron = {
            updateRemoteControlStatus: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.environment).toBe('electron');
        expect(service.platform).toBeUndefined();
        expect(service.isMacOS).toBe(false);
        expect(service.supportsEpg).toBe(false);
        expect(service.supportsSqlite).toBe(false);
        expect(service.supportsXtreamSqliteDataSource).toBe(false);
        expect(service.supportsDownloads).toBe(false);
        expect(service.supportsPortalActivityStorage).toBe(false);
        expect(service.supportsAppStateStorage).toBe(false);
        expect(service.supportsStalkerPlaylistSqliteSync).toBe(false);
        expect(service.supportsPlaylistRefresh).toBe(false);
        expect(service.supportsManagedExternalPlayers).toBe(false);
        expect(service.supportsExternalPlayerPathSettings).toBe(false);
        expect(service.supportsEmbeddedMpv).toBe(false);
        expect(service.supportsDesktopFileSave).toBe(false);
        expect(service.supportsRemoteControl).toBe(false);
        expect(service.supportsXtreamSectionNavigation).toBe(false);
    });

    it('reads the bridge dynamically so tests and late preload setup stay accurate', () => {
        testWindow.electron = undefined;
        const service = new RuntimeCapabilitiesService();

        expect(service.isPwa).toBe(true);

        testWindow.electron = {};

        expect(service.isElectron).toBe(true);
        expect(service.environment).toBe('electron');
    });

    it('keeps the Xtream SQLite data source disabled when only generic SQLite methods exist', () => {
        testWindow.electron = createPlaylistStorageBridge();

        const service = new RuntimeCapabilitiesService();

        expect(service.supportsSqlite).toBe(true);
        expect(service.supportsAppStateStorage).toBe(true);
        expect(service.supportsXtreamSqliteDataSource).toBe(false);
    });

    it('checks app state storage without requiring full playlist SQLite support', () => {
        testWindow.electron = {
            dbGetAppState: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsAppStateStorage).toBe(false);

        testWindow.electron = {
            dbGetAppState: jest.fn(),
            dbSetAppState: jest.fn(),
        };

        expect(service.supportsAppStateStorage).toBe(true);
        expect(service.supportsSqlite).toBe(false);
    });

    it('checks Stalker playlist SQLite sync without requiring the full Xtream data source', () => {
        testWindow.electron = {
            dbGetPlaylist: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsStalkerPlaylistSqliteSync).toBe(false);

        testWindow.electron = {
            dbGetPlaylist: jest.fn(),
            dbCreatePlaylist: jest.fn(),
        };

        expect(service.supportsStalkerPlaylistSqliteSync).toBe(true);
        expect(service.supportsXtreamSqliteDataSource).toBe(false);
    });

    it('decouples external player launch support from path-setting support', () => {
        testWindow.electron = {
            openInMpv: jest.fn(),
            openInVlc: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsManagedExternalPlayers).toBe(true);
        expect(service.supportsExternalPlayerPathSettings).toBe(false);

        testWindow.electron = {
            openInMpv: jest.fn(),
            openInVlc: jest.fn(),
            setMpvPlayerPath: jest.fn(),
            setVlcPlayerPath: jest.fn(),
        };

        expect(service.supportsManagedExternalPlayers).toBe(true);
        expect(service.supportsExternalPlayerPathSettings).toBe(true);
    });

    it('requires the complete EPG preload surface', () => {
        testWindow.electron = {
            fetchEpg: jest.fn(),
            getChannelPrograms: jest.fn(),
            checkEpgFreshness: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsEpg).toBe(false);

        testWindow.electron = {
            fetchEpg: jest.fn(),
            getChannelPrograms: jest.fn(),
            checkEpgFreshness: jest.fn(),
            forceFetchEpg: jest.fn(),
            clearEpgData: jest.fn(),
            getEpgChannelsByRange: jest.fn(),
            searchEpgPrograms: jest.fn(),
        };

        expect(service.supportsEpg).toBe(true);
    });

    it('requires the complete downloads preload surface', () => {
        testWindow.electron = {
            downloadsGetList: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsDownloads).toBe(false);

        testWindow.electron = {
            downloadsStart: jest.fn(),
            downloadsCancel: jest.fn(),
            downloadsRetry: jest.fn(),
            downloadsRemove: jest.fn(),
            downloadsGetList: jest.fn(),
            downloadsGet: jest.fn(),
            downloadsGetDefaultFolder: jest.fn(),
            downloadsSelectFolder: jest.fn(),
            downloadsRevealFile: jest.fn(),
            downloadsPlayFile: jest.fn(),
            downloadsClearCompleted: jest.fn(),
            onDownloadsUpdate: jest.fn(),
        };

        expect(service.supportsDownloads).toBe(true);
    });

    it('requires both desktop file-save preload methods', () => {
        testWindow.electron = {
            saveFileDialog: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsDesktopFileSave).toBe(false);

        testWindow.electron = {
            saveFileDialog: jest.fn(),
            writeFile: jest.fn(),
        };

        expect(service.supportsDesktopFileSave).toBe(true);
    });

    it('requires the complete playlist refresh preload surface', () => {
        testWindow.electron = {
            refreshPlaylist: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsPlaylistRefresh).toBe(false);

        testWindow.electron = {
            refreshPlaylist: jest.fn(),
            cancelPlaylistRefresh: jest.fn(),
            onPlaylistRefreshEvent: jest.fn(),
        };

        expect(service.supportsPlaylistRefresh).toBe(true);
    });

    it('requires the complete playlist storage SQLite preload surface', () => {
        testWindow.electron = {
            dbGetAppPlaylists: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbGetAppState: jest.fn(),
            dbSetAppState: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsSqlite).toBe(false);

        testWindow.electron = createPlaylistStorageBridge();

        expect(service.supportsSqlite).toBe(true);
    });

    it('supports Xtream section navigation in Electron when Xtream API transport is available', () => {
        testWindow.electron = {
            xtreamRequest: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsXtreamSqliteDataSource).toBe(false);
        expect(service.supportsXtreamSectionNavigation).toBe(true);
    });

    it('supports Xtream section navigation in Electron when only the SQLite data source is available', () => {
        testWindow.electron = createXtreamSqliteBridge();

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsXtreamSqliteDataSource).toBe(true);
        expect(service.supportsXtreamSectionNavigation).toBe(true);
    });
});

function createPlaylistStorageBridge(): Record<string, jest.Mock> {
    return {
        dbDeleteAllPlaylists: jest.fn(),
        dbDeletePlaylist: jest.fn(),
        dbGetAppPlaylist: jest.fn(),
        dbGetAppPlaylists: jest.fn(),
        dbGetAppState: jest.fn(),
        dbSetAppState: jest.fn(),
        dbUpsertAppPlaylist: jest.fn(),
        dbUpsertAppPlaylists: jest.fn(),
    };
}

function createXtreamSqliteBridge(): Record<string, jest.Mock> {
    return {
        dbAddFavorite: jest.fn(),
        dbAddRecentItem: jest.fn(),
        dbClearAllPlaybackPositions: jest.fn(),
        dbClearPlaybackPosition: jest.fn(),
        dbClearPlaylistRecentItems: jest.fn(),
        dbCreatePlaylist: jest.fn(),
        dbDeletePlaylist: jest.fn(),
        dbDeleteXtreamContent: jest.fn(),
        dbGetAllCategories: jest.fn(),
        dbGetAllPlaybackPositions: jest.fn(),
        dbGetAppState: jest.fn(),
        dbGetCategories: jest.fn(),
        dbGetContent: jest.fn(),
        dbGetContentByXtreamId: jest.fn(),
        dbGetFavorites: jest.fn(),
        dbGetPlaylist: jest.fn(),
        dbGetPlaybackPosition: jest.fn(),
        dbGetRecentItems: jest.fn(),
        dbGetRecentPlaybackPositions: jest.fn(),
        dbGetSeriesPlaybackPositions: jest.fn(),
        dbHasCategories: jest.fn(),
        dbHasContent: jest.fn(),
        dbIsFavorite: jest.fn(),
        dbRemoveFavorite: jest.fn(),
        dbRemoveRecentItem: jest.fn(),
        dbRestoreXtreamUserData: jest.fn(),
        dbSaveCategories: jest.fn(),
        dbSaveContent: jest.fn(),
        dbSavePlaybackPosition: jest.fn(),
        dbSearchContent: jest.fn(),
        dbSetAppState: jest.fn(),
        dbUpdateCategoryVisibility: jest.fn(),
        dbUpdatePlaylist: jest.fn(),
    };
}
