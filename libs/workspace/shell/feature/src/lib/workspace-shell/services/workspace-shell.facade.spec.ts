import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    PlaylistContextFacade,
    PlaylistRefreshActionService,
    type XtreamRefreshPreparationState,
} from '@iptvnator/playlist/shared/util';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    WorkspaceHeaderContextService,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    WorkspaceStartupPreferencesService,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import { RecentCommandsService } from '../../recent-commands';
import { WorkspacePlayerCommandsContributor } from '../../workspace-player-commands';
import { WorkspaceShellFacade } from './workspace-shell.facade';
import { WorkspaceShellXtreamImportService } from './workspace-shell-xtream-import.service';
import { WorkspaceShellCommandPaletteService } from './workspace-shell-command-palette.service';

class MockXtreamStore {
    readonly recentItems = signal<unknown[]>([]);
    readonly searchTerm = signal('');
    readonly categorySearchTerm = signal('');
    readonly isImporting = signal(false);
    readonly isCancellingImport = signal(false);
    readonly contentInitBlockReason = signal(null);
    readonly activeImportSessionId = signal<string | null>(null);
    readonly currentImportPhase = signal<string | null>(null);
    readonly activeImportContentType = signal<'live' | 'vod' | 'series' | null>(
        null
    );
    readonly activeImportCurrentCount = signal(0);
    readonly activeImportTotalCount = signal(0);
    readonly getImportCount = signal(0);
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
    let recentCommands: {
        entries: jest.Mock;
        record: jest.Mock;
        prune: jest.Mock;
    };
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
    let activePlaylistSignal: ReturnType<
        typeof signal<PlaylistSignalMeta | null>
    >;
    let playlistsSignal: ReturnType<typeof signal<PlaylistSignalMeta[]>>;
    let refreshPreparationSignal: ReturnType<
        typeof signal<XtreamRefreshPreparationState | null>
    >;
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
        refreshPreparationSignal = signal<XtreamRefreshPreparationState | null>(
            null
        );

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
        recentCommands = {
            entries: jest.fn().mockReturnValue([]),
            record: jest.fn(),
            prune: jest.fn(),
        };

        const selectSignal = jest.fn().mockReturnValue(playlistsSignal);

        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellFacade,
                WorkspaceShellXtreamImportService,
                WorkspaceShellCommandPaletteService,
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
                    provide: PlaylistRefreshActionService,
                    useValue: {
                        canRefresh: jest.fn(() => true),
                        isRefreshing: signal(false),
                        refreshPreparation:
                            refreshPreparationSignal.asReadonly(),
                        refresh: jest.fn(),
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
                        instant: (
                            key: string,
                            params?: Record<string, string | number>
                        ) => {
                            if (
                                key ===
                                    'WORKSPACE.SHELL.XTREAM_IMPORT_PROGRESS' &&
                                params
                            ) {
                                return `${params.type} imported: ${params.current} / ${params.total}`;
                            }

                            if (
                                key ===
                                    'WORKSPACE.SHELL.XTREAM_REFRESH_PROGRESS' &&
                                params
                            ) {
                                return `Local records processed: ${params.current} / ${params.total}`;
                            }

                            return key;
                        },
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: RecentCommandsService,
                    useValue: recentCommands,
                },
                {
                    provide: WorkspacePlayerCommandsContributor,
                    useValue: {},
                },
            ],
        });

        facade = TestBed.inject(WorkspaceShellFacade);
    });

    it('routes dashboard search Enter into the active Xtream playlist search', () => {
        const xtreamStore = TestBed.inject(
            XtreamStore
        ) as unknown as MockXtreamStore;

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
        const xtreamStore = TestBed.inject(
            XtreamStore
        ) as unknown as MockXtreamStore;
        const xtreamImport = TestBed.inject(WorkspaceShellXtreamImportService);

        xtreamStore.currentImportPhase.set('loading-categories');
        expect(xtreamImport.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
        );

        xtreamStore.currentImportPhase.set('loading-live');
        expect(xtreamImport.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
        );
        expect(xtreamImport.xtreamImportSourceLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_REMOTE_BADGE'
        );
        expect(xtreamImport.xtreamImportDetailLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_REMOTE'
        );

        xtreamStore.currentImportPhase.set('saving-categories');
        expect(xtreamImport.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING'
        );

        xtreamStore.currentImportPhase.set('saving-content');
        expect(xtreamImport.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING'
        );
        expect(xtreamImport.xtreamImportSourceLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_LOCAL_BADGE'
        );
        expect(xtreamImport.xtreamImportDetailLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_LOCAL'
        );
    });

    it('shows the Xtream overlay during refresh preparation for the active playlist', () => {
        refreshPreparationSignal.set({
            playlistId: 'pl-1',
            operationId: 'xtream-refresh-op',
            phase: 'collecting-user-data',
        });

        expect(facade.showXtreamImportOverlay()).toBe(true);
    });

    it('shows the Xtream overlay during refresh preparation on the dashboard', () => {
        facade.currentUrl.set('/workspace/dashboard');
        refreshPreparationSignal.set({
            playlistId: 'dashboard-xtream-playlist',
            operationId: 'xtream-refresh-op',
            phase: 'collecting-user-data',
        });

        expect(facade.showXtreamImportOverlay()).toBe(true);
    });

    it('does not show the Xtream overlay for another playlist refresh preparation', () => {
        refreshPreparationSignal.set({
            playlistId: 'other-playlist',
            operationId: 'xtream-refresh-op',
            phase: 'collecting-user-data',
        });

        expect(facade.showXtreamImportOverlay()).toBe(false);
    });

    it('prefers refresh-preparation labels over import labels', () => {
        const xtreamStore = TestBed.inject(
            XtreamStore
        ) as unknown as MockXtreamStore;
        const xtreamImport = TestBed.inject(WorkspaceShellXtreamImportService);

        xtreamStore.isImporting.set(true);
        xtreamStore.currentImportPhase.set('loading-categories');
        xtreamStore.activeImportContentType.set('vod');
        xtreamStore.activeImportCurrentCount.set(2);
        xtreamStore.activeImportTotalCount.set(20);
        refreshPreparationSignal.set({
            playlistId: 'pl-1',
            operationId: 'xtream-refresh-op',
            phase: 'deleting-content',
            current: 5,
            total: 10,
        });

        expect(xtreamImport.xtreamImportTitleLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_REFRESH_TITLE'
        );
        expect(xtreamImport.xtreamImportSourceLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_IMPORT_LOCAL_BADGE'
        );
        expect(xtreamImport.xtreamImportPhaseLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_REFRESH_DELETING_CONTENT'
        );
        expect(xtreamImport.xtreamImportDetailLabel()).toBe(
            'WORKSPACE.SHELL.XTREAM_REFRESH_DETAIL_LOCAL'
        );
        expect(xtreamImport.xtreamImportProgressLabel()).toBe(
            'Local records processed: 5 / 10'
        );
    });

    it('builds a type-aware xtream import progress label', () => {
        const xtreamStore = TestBed.inject(
            XtreamStore
        ) as unknown as MockXtreamStore;
        const xtreamImport = TestBed.inject(WorkspaceShellXtreamImportService);

        xtreamStore.activeImportContentType.set('vod');
        xtreamStore.activeImportCurrentCount.set(20);
        xtreamStore.activeImportTotalCount.set(12323);

        expect(xtreamImport.xtreamImportTypeLabel()).toBe(
            'WORKSPACE.SHELL.RAIL_MOVIES'
        );
        expect(xtreamImport.xtreamImportProgressLabel()).toBe(
            'WORKSPACE.SHELL.RAIL_MOVIES imported: 20 / 12,323'
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

        expect(router.navigateByUrl).toHaveBeenCalledWith(
            '/workspace/sources',
            {
                replaceUrl: true,
            }
        );
    });

    it('navigates to the global favorites route', () => {
        router.navigate.mockClear();
        facade.currentUrl.set('/workspace/xtreams/pl-1/vod');

        facade.navigateToGlobalFavorites();

        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace/global-favorites',
        ]);
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
            expect.stringMatching(
                /^\/workspace\/stalker\/pl-1\/recent\?refresh=/
            ),
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

    it('treats stalker radio search as a remote section search', () => {
        facade.currentUrl.set('/workspace/stalker/pl-1/radio?q=jazz');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();
        TestBed.flushEffects();

        expect(stalkerStore.setSearchPhrase).toHaveBeenCalledWith('jazz');
        expect(facade.canUseSearch()).toBe(true);
        expect(facade.searchScopeLabel()).toBe(
            'WORKSPACE.SHELL.RAIL_RADIO / All Items'
        );
        expect(facade.searchStatusLabel()).toBe('');
    });

    it('applies q to Xtream category search on vod routes', () => {
        const xtreamStore = TestBed.inject(
            XtreamStore
        ) as unknown as MockXtreamStore;

        facade.currentUrl.set('/workspace/xtreams/pl-1/vod?q=neo');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();
        TestBed.flushEffects();

        expect(xtreamStore.setCategorySearchTerm).toHaveBeenCalledWith('neo');
        expect(xtreamStore.setSearchTerm).not.toHaveBeenCalled();
    });

    it('applies q to Xtream category search on live routes', () => {
        const xtreamStore = TestBed.inject(
            XtreamStore
        ) as unknown as MockXtreamStore;

        facade.currentUrl.set('/workspace/xtreams/pl-1/live?q=world');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();
        TestBed.flushEffects();

        expect(xtreamStore.setCategorySearchTerm).toHaveBeenCalledWith('world');
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
            {
                icon: 'favorite',
                tooltip: 'HOME.PLAYLISTS.GLOBAL_FAVORITES',
                path: ['/workspace/global-favorites'],
                exact: true,
            },
            {
                icon: 'history',
                tooltip: 'WORKSPACE.SHELL.RAIL_GLOBAL_RECENT',
                path: ['/workspace/global-recent'],
                exact: true,
            },
        ]);
        expect(facade.brandLink()).toBe('/workspace/sources');
    });

    it('persists the last restorable route from navigation events', () => {
        expect(
            startupPreferences.persistLastRestorablePath
        ).toHaveBeenCalledWith('/workspace/xtreams/pl-1/vod');
    });

    it('uses the translated recent scope label on the global recent route', () => {
        facade.currentUrl.set('/workspace/global-recent?q=news');
        (facade as { syncSearchFromRoute: () => void }).syncSearchFromRoute();

        expect(facade.searchScopeLabel()).toBe('PORTALS.RECENTLY_VIEWED');
    });

    it('shows only actionable global commands on an empty dashboard', () => {
        activePlaylistSignal.set(null);
        playlistsSignal.set([]);
        facade.currentUrl.set('/workspace/dashboard');

        const commands = facade.commandPaletteCommands();

        expect(commands.map((command) => command.id)).toEqual([
            'open-global-favorites',
            'open-global-recent',
            'open-downloads',
            'open-settings',
            'open-sources',
            'add-playlist-stalker',
            'add-playlist-xtream',
            'add-playlist-m3u',
            'add-playlist',
        ]);
        expect(commands.every((command) => command.group === 'global')).toBe(
            true
        );
        expect(commands.every((command) => command.enabled)).toBe(true);
    });

    it('includes M3U navigation, playlist actions, and Multi-EPG on playlist routes', () => {
        const headerContext = TestBed.inject(WorkspaceHeaderContextService);

        activePlaylistSignal.set({
            _id: 'pl-m3u',
            title: 'Playlist M3U',
            count: 10,
            importDate: '2026-04-22T10:00:00.000Z',
            autoRefresh: false,
        });
        facade.currentUrl.set('/workspace/playlists/pl-m3u/groups');
        headerContext.setAction({
            id: 'm3u-multi-epg',
            icon: 'view_list',
            tooltipKey: 'TOP_MENU.OPEN_MULTI_EPG',
            ariaLabelKey: 'TOP_MENU.OPEN_MULTI_EPG',
            palette: {
                labelKey: 'TOP_MENU.OPEN_MULTI_EPG',
                descriptionKey:
                    'WORKSPACE.SHELL.COMMANDS.OPEN_MULTI_EPG_DESCRIPTION',
                keywords: ['epg', 'guide', 'schedule'],
                priority: 10,
            },
            run: jest.fn(),
        });

        const commands = facade.commandPaletteCommands();

        expect(commands.map((command) => command.id)).toEqual(
            expect.arrayContaining([
                'm3u-multi-epg',
                'go-to-all',
                'go-to-favorites',
                'go-to-recent',
                'playlist-info',
            ])
        );
        expect(
            commands.find((command) => command.id === 'm3u-multi-epg')?.group
        ).toBe('view');
        expect(commands.some((command) => command.id === 'account-info')).toBe(
            false
        );
    });

    it('places registered current-view commands ahead of globals on global favorites routes', () => {
        const viewCommands = TestBed.inject(WorkspaceViewCommandService);
        const clearCurrent = jest.fn();
        const unregister = viewCommands.registerCommand({
            id: 'clear-current-favorites',
            group: 'view',
            icon: 'delete_sweep',
            labelKey: 'WORKSPACE.SHELL.CLEAR_FAVORITES_TYPE',
            labelParams: () => ({ type: 'Live TV' }),
            descriptionKey:
                'WORKSPACE.SHELL.COMMANDS.CLEAR_CURRENT_VIEW_DESCRIPTION',
            descriptionParams: () => ({ type: 'Live TV' }),
            priority: 10,
            run: clearCurrent,
        });

        facade.currentUrl.set('/workspace/global-favorites');

        const commands = facade.commandPaletteCommands();

        expect(commands[0]?.id).toBe('clear-current-favorites');
        expect(commands[0]?.group).toBe('view');
        expect(
            commands.some((command) => command.id === 'playlist-search')
        ).toBe(false);

        unregister();
    });

    it('records the executed command id after the palette closes with a selection', () => {
        const dialog = TestBed.inject(MatDialog) as unknown as {
            open: jest.Mock;
        };
        dialog.open.mockReturnValueOnce({
            afterClosed: () => of({ commandId: 'open-settings', query: '' }),
        });

        facade.openCommandPalette();

        expect(recentCommands.record).toHaveBeenCalledWith('open-settings');
    });

    it('does not record when the palette closes without a selection', () => {
        const dialog = TestBed.inject(MatDialog) as unknown as {
            open: jest.Mock;
        };
        dialog.open.mockReturnValueOnce({
            afterClosed: () => of(undefined),
        });

        facade.openCommandPalette();

        expect(recentCommands.record).not.toHaveBeenCalled();
    });

    it('does not prune recent ids whose commands are temporarily invisible (e.g. on the same route)', () => {
        const dialog = TestBed.inject(MatDialog) as unknown as {
            open: jest.Mock;
        };
        dialog.open.mockReturnValueOnce({
            afterClosed: () => of(undefined),
        });

        facade.openCommandPalette();

        expect(recentCommands.prune).not.toHaveBeenCalled();
    });
});
