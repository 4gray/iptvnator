import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { filter, firstValueFrom, startWith } from 'rxjs';
import { PlaylistInfoComponent } from '@iptvnator/playlist/shared/ui';
import {
    PlaylistContextFacade,
    PlaylistRefreshActionService,
} from '@iptvnator/playlist/shared/util';
import {
    buildPortalRailLinks,
    PORTAL_EXTERNAL_PLAYBACK,
    PortalRailLink,
    WorkspaceHeaderAction,
    WorkspaceHeaderContextService,
    WorkspaceResolvedCommandItem,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    parseWorkspaceShellRoute,
    WorkspacePortalContext,
    WorkspaceSearchCapability,
    WorkspaceStartupPreferencesService,
} from '@iptvnator/workspace/shell/util';
import { DownloadsService, PlaylistsService, SettingsStore } from '@iptvnator/services';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    WorkspaceAccountInfoData,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import {
    CLEAR_RECENTLY_VIEWED_ARIA,
    CLEAR_RECENTLY_VIEWED_TOOLTIP,
    SEARCH_INPUT_DEBOUNCE_MS,
    SEARCH_LOADED_ONLY_STATUS,
    SEARCH_PLAYLIST_PLACEHOLDER,
    WorkspaceHeaderBulkAction,
} from './helpers/workspace-shell-constants';
import {
    bumpRefreshQueryParam,
    getProviderFromPlaylist,
    getRouteQueryParam,
    syncSearchQueryParam,
} from './helpers/workspace-shell-route-utils';
import {
    resolveSearchPlaceholderKey,
    resolveSearchScopeLabel,
    translateRailLinks,
} from './helpers/workspace-shell-search-labels';
import {
    CommandBuilderActions,
    CommandBuilderContext,
} from './helpers/workspace-shell-command-builders';
import { WorkspaceShellXtreamImportService } from './workspace-shell-xtream-import.service';
import { WorkspaceShellCommandPaletteService } from './workspace-shell-command-palette.service';

export type { WorkspaceHeaderBulkAction } from './helpers/workspace-shell-constants';

@Injectable()
export class WorkspaceShellFacade {
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly destroyRef = inject(DestroyRef);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly settingsStore = inject(SettingsStore);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly workspaceActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly translate = inject(TranslateService);
    private readonly dialog = inject(MatDialog);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly startupPreferences = inject(
        WorkspaceStartupPreferencesService
    );
    readonly headerContext = inject(WorkspaceHeaderContextService);
    private readonly commandPalette = inject(
        WorkspaceShellCommandPaletteService
    );
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private readonly downloadsService = inject(DownloadsService);
    readonly hasActiveDownloads = computed(
        () => this.isElectron && this.downloadsService.activeCount() > 0
    );
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    private searchDebounceTimeoutId: ReturnType<typeof setTimeout> | null =
        null;
    private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
        if (!(event.ctrlKey || event.metaKey)) {
            return;
        }

        if (event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.openCommandPalette();
        }
    };

    readonly playlistTitle = computed(() => {
        const playlist = this.playlistContext.activePlaylist();

        return (
            playlist?.title ||
            playlist?.filename ||
            playlist?.url ||
            playlist?.portalUrl ||
            'Untitled playlist'
        );
    });
    private readonly activePlaylist = this.playlistContext.activePlaylist;
    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );
    readonly hasNoPlaylists = computed(() => this.playlists().length === 0);

    readonly searchQuery = signal('');
    readonly appliedSearchQuery = signal('');
    readonly isElectron = !!window.electron;
    readonly isMacOS = window.electron?.platform === 'darwin';
    readonly currentUrl = signal(this.router.url);
    readonly currentRoute = computed(() =>
        parseWorkspaceShellRoute(this.currentUrl())
    );
    readonly showDashboard = computed(() =>
        this.startupPreferences.showDashboard()
    );
    readonly brandLink = computed(() =>
        this.startupPreferences.getFirstAvailableWorkspacePath(
            this.showDashboard()
        )
    );
    readonly brandTooltipKey = computed(() =>
        this.showDashboard()
            ? 'WORKSPACE.SHELL.RAIL_DASHBOARD'
            : 'WORKSPACE.SHELL.RAIL_SOURCES'
    );
    readonly brandAriaLabelKey = computed(() =>
        this.showDashboard()
            ? 'WORKSPACE.SHELL.OPEN_DASHBOARD'
            : 'WORKSPACE.SHELL.OPEN_SOURCES'
    );
    readonly currentContext = computed(() => this.currentRoute().context);
    readonly currentSection = computed(() => this.currentRoute().section);
    readonly commandPaletteCommands = computed<WorkspaceResolvedCommandItem[]>(
        () => {
            this.languageTick();
            return this.commandPalette.buildPaletteCommands(
                this.makeCommandBuilderContext()
            );
        }
    );
    readonly workspaceLinks = computed<PortalRailLink[]>(() => {
        this.languageTick();

        const links: PortalRailLink[] = [];

        if (this.showDashboard()) {
            links.push({
                icon: 'dashboard',
                tooltip: this.translateText('WORKSPACE.SHELL.RAIL_DASHBOARD'),
                path: ['/workspace/dashboard'],
                exact: true,
            });
        }

        links.push({
            icon: 'library_books',
            tooltip: this.translateText('WORKSPACE.SHELL.RAIL_SOURCES'),
            path: ['/workspace/sources'],
        });

        links.push({
            icon: 'favorite',
            tooltip: this.translateText('HOME.PLAYLISTS.GLOBAL_FAVORITES'),
            path: ['/workspace/global-favorites'],
            exact: true,
        });

        links.push({
            icon: 'history',
            tooltip: this.translateText('WORKSPACE.SHELL.RAIL_GLOBAL_RECENT'),
            path: ['/workspace/global-recent'],
            exact: true,
        });

        return links;
    });
    readonly isDashboardRoute = computed(
        () => this.currentRoute().kind === 'dashboard'
    );
    readonly isSourcesRoute = computed(
        () => this.currentRoute().kind === 'sources'
    );
    readonly isSettingsRoute = computed(
        () => this.currentRoute().kind === 'settings'
    );
    readonly isGlobalDownloadsRoute = computed(
        () => this.currentRoute().kind === 'downloads'
    );
    readonly railContext = computed<WorkspacePortalContext | null>(() => {
        const routeContext = this.currentContext();
        if (routeContext) {
            return routeContext;
        }

        const currentRoute = this.currentRoute();
        if (
            currentRoute.kind !== 'dashboard' &&
            currentRoute.kind !== 'sources' &&
            currentRoute.kind !== 'settings' &&
            currentRoute.kind !== 'global-favorites' &&
            currentRoute.kind !== 'global-recent' &&
            currentRoute.kind !== 'downloads'
        ) {
            return null;
        }

        const activePlaylist = this.activePlaylist();
        if (!activePlaylist?._id) {
            return null;
        }

        return {
            provider: getProviderFromPlaylist(activePlaylist),
            playlistId: activePlaylist._id,
        };
    });
    readonly externalPlaybackSession = this.externalPlayback.visibleSession;
    readonly showExternalPlaybackBar = computed(
        () => this.settingsStore.showExternalPlaybackBar?.() ?? true
    );
    readonly dashboardXtreamContext = computed<WorkspacePortalContext | null>(
        () => {
            if (!this.isDashboardRoute()) {
                return null;
            }

            const context = this.railContext();
            if (!context || context.provider !== 'xtreams') {
                return null;
            }

            return context;
        }
    );
    readonly contextPanel = computed(() => this.currentRoute().contextPanel);
    readonly showContextPanel = computed(
        () => this.currentRoute().contextPanel !== 'none'
    );
    private readonly xtreamImport = inject(WorkspaceShellXtreamImportService);
    readonly showXtreamImportOverlay = computed(() => {
        const route = this.currentRoute();
        const context = this.currentContext();
        const section = this.currentSection();
        const hasRefreshPreparation = Boolean(
            this.xtreamImport.refreshPreparation()
        );

        if (route.kind === 'dashboard') {
            return hasRefreshPreparation;
        }

        if (context?.provider !== 'xtreams') {
            return false;
        }

        const isPreparingCurrentPlaylist =
            this.xtreamImport.isRefreshPreparationRunningForPlaylist(
                context.playlistId
            );

        return (
            (this.xtreamImport.isImportRunning() ||
                isPreparingCurrentPlaylist) &&
            (section === 'vod' ||
                section === 'live' ||
                section === 'series' ||
                section === 'search' ||
                section === 'recently-added')
        );
    });
    readonly searchCapability = computed<WorkspaceSearchCapability>(() => {
        this.languageTick();

        const route = this.currentRoute();
        const context = route.context;
        const section = route.section;
        const appliedQuery = this.appliedSearchQuery().trim();

        if (route.kind === 'settings') {
            return {
                enabled: false,
                behavior: 'disabled',
                context: null,
                section: null,
                searchMode: 'none',
                placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
                scopeLabel: '',
                statusLabel: '',
                minLength: 0,
                advancedRouteTarget: null,
            };
        }

        if (route.kind === 'dashboard') {
            const dashboardContext = this.dashboardXtreamContext();

            return {
                enabled: Boolean(dashboardContext),
                behavior: dashboardContext ? 'advanced-only' : 'disabled',
                context: dashboardContext,
                section: section,
                searchMode: dashboardContext ? 'advanced-only' : 'none',
                placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
                scopeLabel: dashboardContext
                    ? this.translateText('WORKSPACE.SHELL.RAIL_SEARCH')
                    : '',
                statusLabel: '',
                minLength: dashboardContext ? 1 : 0,
                advancedRouteTarget: dashboardContext
                    ? [
                          '/workspace',
                          'xtreams',
                          dashboardContext.playlistId,
                          'search',
                      ]
                    : null,
            };
        }

        if (route.searchMode === 'none') {
            return {
                enabled: false,
                behavior: 'disabled',
                context,
                section,
                searchMode: route.searchMode,
                placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
                scopeLabel: '',
                statusLabel: '',
                minLength: 0,
                advancedRouteTarget: null,
            };
        }

        const isDegradedStalkerItv =
            context?.provider === 'stalker' &&
            section === 'itv' &&
            appliedQuery.length > 0;
        const behavior = isDegradedStalkerItv
            ? 'degraded-loaded-only'
            : route.searchMode;

        return {
            enabled: true,
            behavior,
            context,
            section,
            searchMode: route.searchMode,
            placeholderKey: resolveSearchPlaceholderKey(
                route.kind,
                context,
                section
            ),
            scopeLabel: resolveSearchScopeLabel({
                kind: route.kind,
                context,
                section,
                translate: (key, params) => this.translateText(key, params),
                xtreamCategory: this.xtreamStore.getSelectedCategory(),
                stalkerCategoryName:
                    this.stalkerStore.getSelectedCategoryName(),
            }),
            statusLabel: isDegradedStalkerItv
                ? this.translateText(SEARCH_LOADED_ONLY_STATUS)
                : '',
            minLength: route.searchMode === 'remote-search' ? 3 : 1,
            advancedRouteTarget: null,
        };
    });
    readonly canUseSearch = computed(() => this.searchCapability().enabled);
    readonly searchPlaceholder = computed(
        () => this.searchCapability().placeholderKey
    );
    readonly searchScopeLabel = computed(
        () => this.searchCapability().scopeLabel
    );
    readonly searchStatusLabel = computed(
        () => this.searchCapability().statusLabel
    );
    readonly railProviderClass = computed(() => {
        const context = this.railContext();
        if (!context) {
            return 'rail-context-region';
        }

        return `rail-context-region rail-context-region--${context.provider}`;
    });
    readonly primaryContextLinks = computed<PortalRailLink[]>(() => {
        this.languageTick();

        const context = this.railContext();
        if (!context) {
            return [];
        }

        return translateRailLinks(
            buildPortalRailLinks({
                provider: context.provider,
                playlistId: context.playlistId,
                isElectron: this.isElectron,
                workspace: true,
            }).primary,
            context.provider,
            (key, params) => this.translateText(key, params)
        );
    });
    readonly secondaryContextLinks = computed<PortalRailLink[]>(() => {
        this.languageTick();

        const context = this.railContext();
        if (!context) {
            return [];
        }

        return translateRailLinks(
            buildPortalRailLinks({
                provider: context.provider,
                playlistId: context.playlistId,
                isElectron: this.isElectron,
                workspace: true,
            }).secondary.filter((link) => link.section !== 'downloads'),
            context.provider,
            (key, params) => this.translateText(key, params)
        );
    });
    readonly isDownloadsView = computed(
        () =>
            this.currentSection() === 'downloads' ||
            this.isGlobalDownloadsRoute()
    );
    readonly headerShortcut = computed<WorkspaceHeaderAction | null>(() => {
        const context = this.currentContext();
        const action = this.headerContext.action();

        if (!action || context?.provider !== 'playlists') {
            return null;
        }

        return action;
    });
    readonly canOpenPlaylistInfo = computed(() =>
        Boolean(this.activePlaylist())
    );
    readonly canOpenAccountInfo = computed(() =>
        Boolean(this.activePlaylist()?.serverUrl)
    );
    readonly canRefreshPlaylist = computed(() =>
        this.playlistRefreshAction.canRefresh(this.activePlaylist())
    );
    readonly isRefreshingPlaylist = this.playlistRefreshAction.isRefreshing;
    readonly headerBulkAction = computed<WorkspaceHeaderBulkAction | null>(
        () => {
            this.languageTick();

            const context = this.currentContext();
            const section = this.currentSection();

            if (!context || section !== 'recent') {
                return null;
            }

            if (
                context.provider !== 'xtreams' &&
                context.provider !== 'stalker' &&
                context.provider !== 'playlists'
            ) {
                return null;
            }

            return {
                icon: 'delete_sweep',
                tooltip: this.translateText(CLEAR_RECENTLY_VIEWED_TOOLTIP),
                ariaLabel: this.translateText(CLEAR_RECENTLY_VIEWED_ARIA),
                disabled: this.isRecentCleanupDisabled(context.provider),
            };
        }
    );
    readonly playlistSubtitle = computed(() => {
        this.languageTick();

        const active = this.activePlaylist();
        if (active?.serverUrl) {
            return this.translateText('WORKSPACE.SHELL.XTREAM_CODE');
        }
        if (active?.macAddress) {
            return this.translateText('WORKSPACE.SHELL.STALKER_PORTAL');
        }
        if (active?.count) {
            return this.translateText('WORKSPACE.SHELL.CHANNELS_COUNT', {
                count: active.count,
            });
        }

        const sourcesCount = this.playlists().length;
        if (sourcesCount === 0) {
            return this.translateText('WORKSPACE.SHELL.NO_SOURCES_AVAILABLE');
        }
        if (sourcesCount === 1) {
            return this.translateText('WORKSPACE.SHELL.ONE_SOURCE_AVAILABLE');
        }
        return this.translateText('WORKSPACE.SHELL.SOURCES_AVAILABLE', {
            count: sourcesCount,
        });
    });

    constructor() {
        this.destroyRef.onDestroy(() => {
            if (this.searchDebounceTimeoutId !== null) {
                clearTimeout(this.searchDebounceTimeoutId);
                this.searchDebounceTimeoutId = null;
            }

            document.removeEventListener('keydown', this.onDocumentKeydown);
        });

        document.addEventListener('keydown', this.onDocumentKeydown);

        this.router.events
            .pipe(
                filter(
                    (event): event is NavigationEnd =>
                        event instanceof NavigationEnd
                ),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe((event) => {
                this.currentUrl.set(event.urlAfterRedirects);
                this.startupPreferences.persistLastRestorablePath(
                    event.urlAfterRedirects
                );
                this.syncSearchFromRoute();
            });

        this.syncSearchFromRoute();

        effect(() => {
            const context = this.currentContext();
            const section = this.currentSection();
            const term = this.appliedSearchQuery();

            if (!context || context.provider !== 'xtreams') {
                return;
            }

            if (section === 'search') {
                this.xtreamStore.setSearchTerm(term);
                return;
            }

            if (
                section === 'vod' ||
                section === 'series' ||
                section === 'live'
            ) {
                this.xtreamStore.setCategorySearchTerm(term);
            }
        });

        effect(() => {
            const context = this.currentContext();
            const section = this.currentSection();
            const term = this.appliedSearchQuery();

            if (
                context?.provider !== 'stalker' ||
                !section ||
                (section !== 'vod' &&
                    section !== 'series' &&
                    section !== 'itv' &&
                    section !== 'radio')
            ) {
                return;
            }

            this.stalkerStore.setSearchPhrase(term);
        });

        effect(() => {
            if (!this.currentRoute().usesQuerySearch) {
                return;
            }

            syncSearchQueryParam(
                this.router,
                this.currentUrl(),
                this.appliedSearchQuery()
            );
        });
    }

    closeActiveExternalSession(): void {
        void this.externalPlayback.closeSession(
            this.externalPlayback.activeSession()
        );
    }

    openActiveExternalSessionTarget(): void {
        const playlistId =
            this.externalPlaybackSession()?.contentInfo?.playlistId;
        if (!playlistId) return;

        const playlist = this.playlists().find((p) => p._id === playlistId);
        if (!playlist) return;

        if (playlist.serverUrl) {
            void this.router.navigate(['/workspace', 'xtreams', playlistId]);
        } else if (playlist.macAddress) {
            void this.router.navigate(['/workspace', 'stalker', playlistId]);
        } else {
            void this.router.navigate(['/workspace', 'playlists', playlistId]);
        }
    }

    onSearchInput(value: string): void {
        this.searchQuery.set(value);
        this.scheduleSearchApply(value);
    }

    onSearchEnter(value: string): void {
        const trimmedValue = value.trim();
        this.searchQuery.set(trimmedValue);

        if (this.searchCapability().behavior === 'advanced-only') {
            const advancedRouteTarget =
                this.searchCapability().advancedRouteTarget;
            if (!advancedRouteTarget) {
                this.applySearchQuery(trimmedValue);
                return;
            }

            this.xtreamStore.setSearchTerm(trimmedValue);
            this.applySearchQuery(trimmedValue);
            void this.router.navigate(advancedRouteTarget, {
                queryParams: trimmedValue ? { q: trimmedValue } : {},
            });
            return;
        }

        this.applySearchQuery(trimmedValue);
    }

    openAddPlaylistDialog(): void {
        this.workspaceActions.openAddPlaylistDialog();
    }

    openCommandPalette(): void {
        this.commandPalette.openCommandPalette(
            this.makeCommandBuilderContext(),
            this.searchQuery()
        );
    }

    async runHeaderBulkAction(): Promise<void> {
        const context = this.currentContext();
        const section = this.currentSection();

        if (!context || section !== 'recent') {
            return;
        }

        if (context.provider === 'xtreams') {
            this.xtreamStore.clearRecentItems({ id: context.playlistId });
            return;
        }

        if (context.provider === 'stalker') {
            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.clearPortalRecentlyViewed(
                    context.playlistId
                )
            );
            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: context.playlistId,
                        recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                    } as PlaylistMeta,
                })
            );
            bumpRefreshQueryParam(this.router, this.currentUrl());
            return;
        }

        if (context.provider === 'playlists') {
            const updatedPlaylist = await firstValueFrom(
                this.playlistsService.clearM3uRecentlyViewed(context.playlistId)
            );
            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({
                    playlist: {
                        _id: context.playlistId,
                        recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                    } as PlaylistMeta,
                })
            );
            bumpRefreshQueryParam(this.router, this.currentUrl());
        }
    }

    navigateToGlobalFavorites(): void {
        void this.router.navigate(['/workspace/global-favorites']);
    }

    openDownloadsShortcut(): void {
        void this.router.navigate(['/workspace/downloads']);
    }

    runHeaderShortcut(): void {
        this.headerShortcut()?.run();
    }

    openGlobalSearch(initialQuery = ''): void {
        this.workspaceActions.openGlobalSearch(initialQuery);
    }

    openGlobalRecent(): void {
        this.workspaceActions.openGlobalRecent();
    }

    openPlaylistInfo(): void {
        const playlist = this.activePlaylist();
        if (!playlist) {
            return;
        }

        this.dialog.open(PlaylistInfoComponent, {
            data: playlist,
        });
    }

    openAccountInfo(): void {
        if (!this.canOpenAccountInfo()) {
            return;
        }

        const data: WorkspaceAccountInfoData = {
            vodStreamsCount: this.xtreamStore.vodStreams().length,
            liveStreamsCount: this.xtreamStore.liveStreams().length,
            seriesCount: this.xtreamStore.serialStreams().length,
        };
        this.workspaceActions.openAccountInfo(data);
    }

    refreshCurrentPlaylist(): void {
        const playlist = this.activePlaylist();

        if (!playlist || !this.canRefreshPlaylist()) {
            return;
        }

        this.playlistRefreshAction.refresh(playlist);
    }

    private makeCommandBuilderContext(): CommandBuilderContext {
        return {
            route: this.currentRoute(),
            context: this.currentContext(),
            section: this.currentSection(),
            hasActivePlaylist: !!this.activePlaylist(),
            hasXtreamPlaylists: this.playlists().some(
                (playlist) => !!playlist.serverUrl
            ),
            canRefreshPlaylist: this.canRefreshPlaylist(),
            isElectron: this.isElectron,
            showDashboard: this.showDashboard(),
            translate: (key, params) => this.translateText(key, params),
            router: this.router,
            actions: this.commandBuilderActions,
        };
    }

    private readonly commandBuilderActions: CommandBuilderActions = {
        openPlaylistSearch: (query) =>
            this.openPlaylistSearchFromPalette(query),
        refreshCurrentPlaylist: () => this.refreshCurrentPlaylist(),
        openPlaylistInfo: () => this.openPlaylistInfo(),
        openAccountInfo: () => this.openAccountInfo(),
        openGlobalSearch: (query) => this.openGlobalSearch(query),
        navigateToGlobalFavorites: () => this.navigateToGlobalFavorites(),
        openGlobalRecent: () => this.openGlobalRecent(),
        openDownloadsShortcut: () => this.openDownloadsShortcut(),
        openAddPlaylistDialog: (kind) =>
            kind
                ? this.workspaceActions.openAddPlaylistDialog(kind)
                : this.workspaceActions.openAddPlaylistDialog(),
    };

    private openPlaylistSearchFromPalette(query: string): void {
        const effectiveContext =
            this.dashboardXtreamContext() ?? this.currentContext();

        if (!effectiveContext) {
            return;
        }

        this.searchQuery.set(query);
        this.appliedSearchQuery.set(query);

        if (effectiveContext.provider === 'xtreams') {
            this.xtreamStore.setSearchTerm(query);
            void this.router.navigate(
                [
                    '/workspace',
                    'xtreams',
                    effectiveContext.playlistId,
                    'search',
                ],
                {
                    queryParams: query ? { q: query } : {},
                }
            );
            return;
        }

        if (effectiveContext.provider === 'stalker') {
            void this.router.navigate(
                [
                    '/workspace',
                    'stalker',
                    effectiveContext.playlistId,
                    'search',
                ],
                {
                    queryParams: query ? { q: query } : {},
                }
            );
        }
    }

    private syncSearchFromRoute(): void {
        if (this.currentRoute().usesQuerySearch) {
            this.setSearchState(
                getRouteQueryParam(this.router, this.currentUrl(), 'q')
            );
            return;
        }

        this.setSearchState('');
    }

    private setSearchState(value: string): void {
        if (this.searchDebounceTimeoutId !== null) {
            clearTimeout(this.searchDebounceTimeoutId);
            this.searchDebounceTimeoutId = null;
        }

        this.searchQuery.set(value);
        this.appliedSearchQuery.set(value);
    }

    private scheduleSearchApply(value: string): void {
        if (this.searchDebounceTimeoutId !== null) {
            clearTimeout(this.searchDebounceTimeoutId);
        }

        this.searchDebounceTimeoutId = setTimeout(() => {
            this.searchDebounceTimeoutId = null;
            this.applySearchQuery(value);
        }, SEARCH_INPUT_DEBOUNCE_MS);
    }

    private applySearchQuery(value: string): void {
        this.appliedSearchQuery.set(value);
    }

    private isRecentCleanupDisabled(
        provider: WorkspacePortalContext['provider']
    ): boolean {
        if (provider === 'xtreams') {
            return this.xtreamStore.recentItems().length === 0;
        }

        if (provider === 'playlists') {
            return (this.activePlaylist()?.recentlyViewed?.length ?? 0) === 0;
        }

        return false;
    }

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
