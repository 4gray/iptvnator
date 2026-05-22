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
        expect(service.supportsManagedExternalPlayers).toBe(false);
        expect(service.supportsEmbeddedMpv).toBe(false);
        expect(service.supportsDesktopFileSave).toBe(false);
        expect(service.supportsRemoteControl).toBe(false);
        expect(service.supportsXtreamSectionNavigation).toBe(false);
    });

    it('reports Electron capabilities from the available preload bridge methods', () => {
        testWindow.electron = {
            platform: 'darwin',
            dbGetAppPlaylists: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
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
            dbDeletePlaylist: jest.fn(),
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
            openInMpv: jest.fn(),
            openInVlc: jest.fn(),
            prepareEmbeddedMpv: jest.fn(),
            saveFileDialog: jest.fn(),
            writeFile: jest.fn(),
            updateRemoteControlStatus: jest.fn(),
            onChannelChange: jest.fn(),
            onRemoteControlCommand: jest.fn(),
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
        expect(service.supportsManagedExternalPlayers).toBe(true);
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
        expect(service.supportsEpg).toBe(true);
        expect(service.supportsSqlite).toBe(false);
        expect(service.supportsXtreamSqliteDataSource).toBe(false);
        expect(service.supportsDownloads).toBe(false);
        expect(service.supportsPortalActivityStorage).toBe(false);
        expect(service.supportsManagedExternalPlayers).toBe(false);
        expect(service.supportsEmbeddedMpv).toBe(false);
        expect(service.supportsDesktopFileSave).toBe(false);
        expect(service.supportsRemoteControl).toBe(false);
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
        testWindow.electron = {
            dbGetAppPlaylists: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbGetAppState: jest.fn(),
            dbSetAppState: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.supportsSqlite).toBe(true);
        expect(service.supportsXtreamSqliteDataSource).toBe(false);
    });

    it('requires both managed external player launch methods', () => {
        testWindow.electron = {
            openInMpv: jest.fn(),
        };

        const service = new RuntimeCapabilitiesService();

        expect(service.isElectron).toBe(true);
        expect(service.supportsManagedExternalPlayers).toBe(false);

        testWindow.electron = {
            openInMpv: jest.fn(),
            openInVlc: jest.fn(),
        };

        expect(service.supportsManagedExternalPlayers).toBe(true);
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
});
