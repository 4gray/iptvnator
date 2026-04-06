import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    PlaylistsService,
    SettingsStore,
} from 'services';
import { PlaylistMeta } from 'shared-interfaces';
import {
    WorkspaceStartupPreferencesService,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import { WorkspaceShellFacade } from './workspace-shell.facade';

class MockXtreamStore {
    readonly recentItems = signal<unknown[]>([]);
    readonly searchTerm = signal('');
    readonly categorySearchTerm = signal('');
    readonly isImporting = signal(false);
    readonly activeImportSessionId = signal<string | null>(null);
    readonly currentImportPhase = signal<string | null>(null);
    readonly itemsToImport = signal(0);
    readonly getSelectedCategory = signal<{
        category_name?: string;
        name?: string;
    } | null>(null);
    readonly vodStreams = signal<unknown[]>([{ id: 1 }]);
    readonly liveStreams = signal<unknown[]>([{ id: 2 }]);
    readonly serialStreams = signal<unknown[]>([{ id: 3 }]);

    setSearchTerm = jest.fn((term: string) => this.searchTerm.set(term));
    setCategorySearchTerm = jest.fn((term: string) =>
        this.categorySearchTerm.set(term)
    );
    clearRecentItems = jest.fn();
}

class MockStalkerStore {
    readonly searchPhrase = signal('');
    readonly getSelectedCategoryName = signal('All Items');

    setSearchPhrase = jest.fn((term: string) => this.searchPhrase.set(term));
}

function createParseUrl(url: string): { queryParams: Record<string, unknown> } {
    const parsed = new URL(url, 'http://localhost');
    const queryParams: Record<string, unknown> = {};

    parsed.searchParams.forEach((value, key) => {
        const currentValue = queryParams[key];
        if (currentValue === undefined) {
            queryParams[key] = value;
            return;
        }

        if (Array.isArray(currentValue)) {
            currentValue.push(value);
            return;
        }

        queryParams[key] = [currentValue, value];
    });

    return { queryParams };
}

describe('WorkspaceShellFacade', () => {
    type PlaylistSignalMeta = PlaylistMeta & {
        serverUrl?: string;
        macAddress?: string;
    };

    let facade: WorkspaceShellFacade;
    let router: {
        url: string;
        events: ReturnType<typeof of>;
        navigate: jest.Mock;
        navigateByUrl: jest.Mock;
        parseUrl: jest.Mock;
        createUrlTree: jest.Mock;
        isActive: jest.Mock;
    };
    let playlistsService: {
        clearPortalRecentlyViewed: jest.Mock;
        clearM3uRecentlyViewed: jest.Mock;
    };
    let workspaceActions: {
        openAddPlaylistDialog: jest.Mock;
        openGlobalSearch: jest.Mock;
        openGlobalRecent: jest.Mock;
        openAccountInfo: jest.Mock;
    };
    let storeDispatch: jest.Mock;
    let activePlaylistSignal: ReturnType<typeof signal<PlaylistSignalMeta>>;
    let playlistsSignal: ReturnType<typeof signal<PlaylistSignalMeta[]>>;
    let stalkerStore: MockStalkerStore;
    let showDashboardSignal: ReturnType<typeof signal<boolean>>;
    let startupPreferences: {
        getFirstAvailableWorkspacePath: jest.Mock;
        persistLastRestorablePath: jest.Mock;
        showDashboard: jest.Mock;
    };

    beforeEach(() => {
        window.electron = { platform: 'darwin' } as typeof window.electron;
        showDashboardSignal = signal(true);

        activePlaylistSignal = signal({
            _id: 'pl-1',
            serverUrl: 'http://example.com',
            title: 'Playlist A',
            recentlyViewed: ['recent-1'],
        });
        playlistsSignal = signal([
            { _id: 'pl-1', serverUrl: 'http://example.com' },
            { _id: 'pl-2', macAddress: '00:11:22:33' },
        ]);

        router = {
            url: '/workspace/xtreams/pl-1/vod',
            events: of(
                new NavigationEnd(
                    1,
                    '/workspace/xtreams/pl-1/vod',
                    '/workspace/xtreams/pl-1/vod'
                )
            ),
            navigate: jest.fn().mockResolvedValue(true),
            navigateByUrl: jest.fn().mockResolvedValue(true),
            parseUrl: jest.fn((url: string) => createParseUrl(url)),
            createUrlTree: jest.fn(),
            isActive: jest.fn(),
        };
        playlistsService = {
            clearPortalRecentlyViewed: jest
                .fn()
                .mockReturnValue(of({ recentlyViewed: [] })),
            clearM3uRecentlyViewed: jest
                .fn()
                .mockReturnValue(of({ recentlyViewed: [] })),
        };
        workspaceActions = {
            openAddPlaylistDialog: jest.fn(),
            openGlobalSearch: jest.fn(),
            openGlobalRecent: jest.fn(),
            openAccountInfo: jest.fn(),
        };
        startupPreferences = {
            getFirstAvailableWorkspacePath: jest.fn((showDashboard: boolean) =>
                showDashboard ? '/workspace/dashboard' : '/workspace/sources'
            ),
            persistLastRestorablePath: jest.fn(),
            showDashboard: jest.fn(() => showDashboardSignal()),
        };
        storeDispatch = jest.fn();
        stalkerStore = new MockStalkerStore();

        const selectSignal = jest.fn().mockReturnValue(playlistsSignal);

        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellFacade,
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal,
                        dispatch: storeDispatch,
                    },
                },
                {
                    provide: XtreamStore,
                    useClass: MockXtreamStore,
                },
                {
                    provide: StalkerStore,
                    useValue: stalkerStore,
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: {
                        activeSession: signal(null),
                        visibleSession: signal(null),
                        closeSession: jest.fn(),
                    },
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        activePlaylist: activePlaylistSignal,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        showExternalPlaybackBar: signal(true),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
                {
                    provide: MatDialog,
                    useValue: {
                        open: jest.fn().mockReturnValue({
                            afterClosed: () => of(undefined),
                        }),
                    },
                },
                {
                    provide: WORKSPACE_SHELL_ACTIONS,
                    useValue: workspaceActions,
                },
                {
                    provide: WorkspaceStartupPreferencesService,
                    useValue: startupPreferences,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        });

        facade = TestBed.inject(WorkspaceShellFacade);
    });

    it('routes dashboard search Enter into the active Xtream playlist search', () => {
        const xtreamStore = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;

        facade.currentUrl.set('/workspace/dashboard');
        router.navigate.mockClear();

        facade.onSearchEnter('Matrix');

        expect(xtreamStore.setSearchTerm).toHaveBeenCalledWith('Matrix');
        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'pl-1', 'search'],
            {
                queryParams: { q: 'Matrix' },
            }
        );
    });

    it('uses a loading label for remote Xtream fetch phases', () => {
        const xtreamStore = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;

        xtreamStore.currentImportPhase.set('loading-categories');
        expect(facade.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
        );

        xtreamStore.currentImportPhase.set('loading-live');
        expect(facade.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
        );
        expect(facade.xtreamImportSourceLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_REMOTE_BADGE'
        );
        expect(facade.xtreamImportDetailLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_REMOTE'
        );

        xtreamStore.currentImportPhase.set('saving-categories');
        expect(facade.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING'
        );

        xtreamStore.currentImportPhase.set('saving-content');
        expect(facade.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING'
        );
        expect(facade.xtreamImportSourceLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_LOCAL_BADGE'
        );
        expect(facade.xtreamImportDetailLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_LOCAL'
        );
    });

    it('keeps stalker local-filter routes on the same page and syncs q', () => {
        router.navigate.mockClear();
        router.navigateByUrl.mockClear();
        facade.currentUrl.set('/workspace/stalker/pl-1/downloads');

        facade.onSearchEnter('Neo');
        TestBed.flushEffects();

        expect(router.navigate).not.toHaveBeenCalled();
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            '/workspace/stalker/pl-1/downloads?q=Neo',
            {
                replaceUrl: true,
            }
        );
    });

    it('removes the q param when clearing a sources search', async () => {
        facade.appliedSearchQuery.set('matrix');
        facade.currentUrl.set('/workspace/sources?q=matrix');
        router.navigateByUrl.mockClear();

        facade.onSearchEnter('');
        TestBed.flushEffects();

        expect(router.navigateByUrl).toHaveBeenCalledWith('/workspace/sources', {
            replaceUrl: true,
        });
    });

    it('prefers provider-scoped global favorites when rail context exists', () => {
        router.navigate.mockClear();
        facade.currentUrl.set('/workspace/xtreams/pl-1/vod');

        facade.navigateToGlobalFavorites();

        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'pl-1', 'favorites'],
            {
                queryParams: { scope: 'all' },
            }
        );
    });

    it('clears stalker recent items and refreshes the route', async () => {
        facade.currentUrl.set('/workspace/stalker/pl-1/recent');
        router.navigateByUrl.mockClear();

        await facade.runHeaderBulkAction();

        expect(playlistsService.clearPortalRecentlyViewed).toHaveBeenCalledWith(
            'pl-1'
        );
        expect(storeDispatch).toHaveBeenCalled();
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            expect.stringMatching(/^\/workspace\/stalker\/pl-1\/recent\?refresh=/),
            {
                replaceUrl: true,
            }
        );
    });

    it('exposes loaded-only status for stalker itv searches', () => {
        facade.currentUrl.set('/workspace/stalker/pl-1/itv?q=cnn');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();
        TestBed.flushEffects();

        expect(stalkerStore.setSearchPhrase).toHaveBeenCalledWith('cnn');
        expect(facade.canUseSearch()).toBe(true);
        expect(facade.searchStatusLabel()).toBe(
            'WORKSPACE.SHELL.SEARCH_STATUS_LOADED_ONLY'
        );
    });

    it('applies q to Xtream category search on vod routes', () => {
        const xtreamStore = TestBed.inject(XtreamStore) as unknown as MockXtreamStore;

        facade.currentUrl.set('/workspace/xtreams/pl-1/vod?q=neo');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();
        TestBed.flushEffects();

        expect(xtreamStore.setCategorySearchTerm).toHaveBeenCalledWith('neo');
        expect(xtreamStore.setSearchTerm).not.toHaveBeenCalled();
    });

    it('enables local-filter search on playlist favorites routes', () => {
        facade.currentUrl.set('/workspace/playlists/pl-1/favorites?q=news');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();

        expect(facade.canUseSearch()).toBe(true);
        expect(facade.searchQuery()).toBe('news');
    });

    it('uses the translated global favorites scope label on the global favorites route', () => {
        facade.currentUrl.set('/workspace/global-favorites?q=news');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();

        expect(facade.searchScopeLabel()).toBe(
            'HOME.PLAYLISTS.GLOBAL_FAVORITES'
        );
    });

    it('removes the dashboard rail link when dashboard is hidden', () => {
        showDashboardSignal.set(false);

        expect(facade.workspaceLinks()).toEqual([
            {
                icon: 'library_books',
                tooltip: 'WORKSPACE.SHELL.RAIL_SOURCES',
                path: ['/workspace/sources'],
            },
        ]);
        expect(facade.brandLink()).toBe('/workspace/sources');
    });

    it('persists the last restorable route from navigation events', () => {
        expect(startupPreferences.persistLastRestorablePath).toHaveBeenCalledWith(
            '/workspace/xtreams/pl-1/vod'
        );
    });

    it('uses the translated recent scope label on the global recent route', () => {
        facade.currentUrl.set('/workspace/global-recent?q=news');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();

        expect(facade.searchScopeLabel()).toBe('PORTALS.RECENTLY_VIEWED');
    });
});
