import { TestBed } from '@angular/core/testing';
import {
    DatabaseService,
    PlaybackPositionService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';
import { ElectronXtreamDataSource } from './electron-xtream-data-source';

/**
 * Shared test setup for ElectronXtreamDataSource specs.
 * Mocks the full DataService/IPC boundary — no real DB is touched.
 */

export const credentials: XtreamCredentials = {
    serverUrl: 'http://localhost:3211',
    username: 'demo',
    password: 'secret',
};

export function createDbServiceMock() {
    return {
        getXtreamImportStatus: jest.fn().mockResolvedValue('idle'),
        getPlaylistById: jest.fn().mockResolvedValue(null),
        createPlaylist: jest.fn().mockResolvedValue(undefined),
        updateXtreamPlaylistDetails: jest.fn().mockResolvedValue(undefined),
        deletePlaylist: jest.fn().mockResolvedValue(undefined),
        hasXtreamCategories: jest.fn().mockResolvedValue(false),
        getXtreamCategories: jest.fn().mockResolvedValue([]),
        saveXtreamCategories: jest.fn().mockResolvedValue(undefined),
        getAllXtreamCategories: jest.fn().mockResolvedValue([]),
        updateCategoryVisibility: jest.fn().mockResolvedValue(undefined),
        hasXtreamContent: jest.fn().mockResolvedValue(false),
        getXtreamContent: jest.fn().mockResolvedValue([]),
        saveXtreamContent: jest.fn().mockResolvedValue(0),
        searchXtreamContent: jest.fn().mockResolvedValue([]),
        getFavorites: jest.fn().mockResolvedValue([]),
        addToFavorites: jest.fn().mockResolvedValue(undefined),
        removeFromFavorites: jest.fn().mockResolvedValue(undefined),
        isFavorite: jest.fn().mockResolvedValue(false),
        getRecentItems: jest.fn().mockResolvedValue([]),
        addRecentItem: jest.fn().mockResolvedValue(undefined),
        removeRecentItem: jest.fn().mockResolvedValue(undefined),
        clearPlaylistRecentItems: jest.fn().mockResolvedValue(undefined),
        getContentByXtreamId: jest.fn().mockResolvedValue(null),
        setContentBackdropIfMissing: jest.fn().mockResolvedValue(undefined),
        deleteXtreamPlaylistContent: jest.fn().mockResolvedValue({
            hiddenCategories: [],
            favorites: [],
            recentlyViewed: [],
        }),
        restoreXtreamUserData: jest.fn().mockResolvedValue(undefined),
    };
}

export function createPlaybackServiceMock() {
    return {
        savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
        getPlaybackPosition: jest.fn().mockResolvedValue(null),
        getSeriesPlaybackPositions: jest.fn().mockResolvedValue([]),
        getRecentPlaybackPositions: jest.fn().mockResolvedValue([]),
        getAllPlaybackPositions: jest.fn().mockResolvedValue([]),
        clearPlaybackPosition: jest.fn().mockResolvedValue(undefined),
        clearAllPlaybackPositions: jest.fn().mockResolvedValue(undefined),
    };
}

export function createPendingRestoreServiceMock() {
    return {
        get: jest.fn().mockReturnValue(null),
    };
}

export function createApiServiceMock() {
    return {
        getCategories: jest.fn().mockResolvedValue([]),
        getStreams: jest.fn().mockResolvedValue([]),
    };
}

export interface ElectronXtreamDataSourceHarness {
    dataSource: ElectronXtreamDataSource;
    dbService: ReturnType<typeof createDbServiceMock>;
    playbackService: ReturnType<typeof createPlaybackServiceMock>;
    pendingRestoreService: ReturnType<typeof createPendingRestoreServiceMock>;
    apiService: ReturnType<typeof createApiServiceMock>;
}

export function setupElectronXtreamDataSource(): ElectronXtreamDataSourceHarness {
    const dbService = createDbServiceMock();
    const playbackService = createPlaybackServiceMock();
    const pendingRestoreService = createPendingRestoreServiceMock();
    const apiService = createApiServiceMock();

    TestBed.configureTestingModule({
        providers: [
            ElectronXtreamDataSource,
            { provide: DatabaseService, useValue: dbService },
            { provide: PlaybackPositionService, useValue: playbackService },
            {
                provide: XtreamPendingRestoreService,
                useValue: pendingRestoreService,
            },
            { provide: XtreamApiService, useValue: apiService },
        ],
    });

    return {
        dataSource: TestBed.inject(ElectronXtreamDataSource),
        dbService,
        playbackService,
        pendingRestoreService,
        apiService,
    };
}
