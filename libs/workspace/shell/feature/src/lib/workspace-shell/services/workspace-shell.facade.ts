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
import {
    PlaylistInfoComponent,
    PlaylistType,
} from '@iptvnator/playlist/shared/ui';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    buildPortalRailLinks,
    PORTAL_EXTERNAL_PLAYBACK,
    PortalRailLink,
    PortalRailSection,
    WorkspaceHeaderAction,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    parseWorkspaceShellRoute,
    WorkspacePortalContext,
    WorkspaceShellPageKind,
    WorkspaceSearchCapability,
} from '@iptvnator/workspace/shell/util';
import { PlaylistsService, SettingsStore } from 'services';
import { PlaylistActions, selectAllPlaylistsMeta } from 'm3u-state';
import { PlaylistMeta } from 'shared-interfaces';
import {
    WorkspaceAccountInfoData,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import {
    WorkspaceCommandId,
    WorkspaceCommandItem,
    WorkspaceCommandPaletteComponent,
    WorkspaceCommandScope,
    WorkspaceCommandSelection,
} from '../../workspace-command-palette/workspace-command-palette.component';

export interface WorkspaceHeaderBulkAction {
    icon: string;
    tooltip: string;
    ariaLabel: string;
    disabled: boolean;
}

interface WorkspaceCommandAvailability {
    context: WorkspacePortalContext | null;
    dashboardXtreamContext: WorkspacePortalContext | null;
    hasXtreamPlaylists: boolean;
    isElectron: boolean;
}

interface WorkspaceCommandDefinition {
    id: WorkspaceCommandId;
    labelKey: string;
    descriptionKey: string;
    scope: WorkspaceCommandScope;
    isEnabled: (state: WorkspaceCommandAvailability) => boolean;
}

const SEARCH_INPUT_DEBOUNCE_MS = 350;
const SEARCH_PLAYLIST_PLACEHOLDER =
    'WORKSPACE.SHELL.SEARCH_PLAYLIST_PLACEHOLDER';
const SEARCH_SECTION_PLACEHOLDER = 'WORKSPACE.SHELL.SEARCH_SECTION_PLACEHOLDER';
const FILTER_SECTION_PLACEHOLDER = 'WORKSPACE.SHELL.FILTER_SECTION_PLACEHOLDER';
const SEARCH_SOURCES_PLACEHOLDER = 'WORKSPACE.SHELL.SEARCH_SOURCES_PLACEHOLDER';
const SEARCH_LOADED_ONLY_STATUS = 'WORKSPACE.SHELL.SEARCH_STATUS_LOADED_ONLY';
const CLEAR_RECENTLY_VIEWED_TOOLTIP =
    'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_SECTION';
const CLEAR_RECENTLY_VIEWED_ARIA =
    'WORKSPACE.SHELL.CLEAR_RECENTLY_VIEWED_SECTION_ARIA';

const RAIL_TOOLTIP_KEYS: Readonly<Partial<Record<PortalRailSection, string>>> =
    {
        vod: 'WORKSPACE.SHELL.RAIL_MOVIES',
        live: 'WORKSPACE.SHELL.RAIL_LIVE',
        itv: 'WORKSPACE.SHELL.RAIL_LIVE',
        series: 'WORKSPACE.SHELL.RAIL_SERIES',
        'recently-added': 'WORKSPACE.SHELL.RAIL_RECENTLY_ADDED',
        search: 'WORKSPACE.SHELL.RAIL_SEARCH',
        recent: 'WORKSPACE.SHELL.RAIL_RECENT',
        favorites: 'WORKSPACE.SHELL.RAIL_FAVORITES',
        downloads: 'WORKSPACE.SHELL.RAIL_DOWNLOADS',
        all: 'WORKSPACE.SHELL.RAIL_ALL_CHANNELS',
        groups: 'WORKSPACE.SHELL.RAIL_GROUPS',
    };

const WORKSPACE_COMMAND_DEFINITIONS: readonly WorkspaceCommandDefinition[] = [
    {
        id: 'global-search',
        labelKey: 'WORKSPACE.SHELL.COMMANDS.GLOBAL_SEARCH_LABEL',
        descriptionKey: 'WORKSPACE.SHELL.COMMANDS.GLOBAL_SEARCH_DESCRIPTION',
        scope: 'global',
        isEnabled: (state) => state.hasXtreamPlaylists,
    },
    {
        id: 'playlist-search',
        labelKey: 'WORKSPACE.SHELL.COMMANDS.PLAYLIST_SEARCH_LABEL',
        descriptionKey: 'WORKSPACE.SHELL.COMMANDS.PLAYLIST_SEARCH_DESCRIPTION',
        scope: 'playlist',
        isEnabled: (state) =>
            Boolean(
                state.dashboardXtreamContext ||
                (state.context &&
                    (state.context.provider === 'xtreams' ||
                        state.context.provider === 'stalker'))
            ),
    },
    {
        id: 'open-global-favorites',
        labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_FAVORITES_LABEL',
        descriptionKey:
            'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_FAVORITES_DESCRIPTION',
        scope: 'global',
        isEnabled: () => true,
    },
    {
        id: 'open-downloads',
        labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_DOWNLOADS_LABEL',
        descriptionKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_DOWNLOADS_DESCRIPTION',
        scope: 'global',
        isEnabled: (state) => state.isElectron,
    },
    {
        id: 'open-global-recent',
        labelKey: 'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_RECENT_LABEL',
        descriptionKey:
            'WORKSPACE.SHELL.COMMANDS.OPEN_GLOBAL_RECENT_DESCRIPTION',
        scope: 'global',
        isEnabled: () => true,
    },
];

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
    readonly headerContext = inject(WorkspaceHeaderContextService);
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

    readonly searchQuery = signal('');
    readonly appliedSearchQuery = signal('');
    readonly isElectron = !!window.electron;
    readonly isMacOS = window.electron?.platform === 'darwin';
    readonly currentUrl = signal(this.router.url);
    readonly currentRoute = computed(() =>
        parseWorkspaceShellRoute(this.currentUrl())
    );
    readonly currentContext = computed(() => this.currentRoute().context);
    readonly currentSection = computed(() => this.currentRoute().section);
    readonly workspaceLinks = computed<PortalRailLink[]>(() => {
        this.languageTick();

        return [
            {
                icon: 'dashboard',
                tooltip: this.translateText('WORKSPACE.SHELL.RAIL_DASHBOARD'),
                path: ['/workspace/dashboard'],
                exact: true,
            },
            {
                icon: 'library_books',
                tooltip: this.translateText('WORKSPACE.SHELL.RAIL_SOURCES'),
                path: ['/workspace/sources'],
            },
        ];
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
    readonly isGlobalFavoritesRoute = computed(
        () => this.currentRoute().kind === 'global-favorites'
    );
    readonly isPortalFavoritesAllScope = computed(
        () => this.currentRoute().isPortalFavoritesAllScope
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
            provider: this.getProviderFromPlaylist(activePlaylist),
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
    readonly xtreamImportCount = this.xtreamStore.getImportCount;
    readonly xtreamItemsToImport = this.xtreamStore.itemsToImport;
    readonly xtreamImportPhase = this.xtreamStore.currentImportPhase;
    readonly isCancellingXtreamImport = this.xtreamStore.isCancellingImport;
    readonly canCancelXtreamImport = computed(
        () =>
            this.isElectron &&
            this.xtreamStore.isImporting() &&
            this.xtreamStore.activeImportOperationIds().length > 0 &&
            !this.xtreamStore.isCancellingImport()
    );
    readonly xtreamImportPhaseLabel = computed(() => {
        this.languageTick();

        switch (this.xtreamStore.currentImportPhase()) {
            case 'preparing-content':
                return this.translateText(
                    'WORKSPACE.SHELL.XTREAM_IMPORT_PREPARING'
                );
            case 'saving-content':
                return this.translateText(
                    'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING'
                );
            case 'restoring-favorites':
                return this.translateText(
                    'WORKSPACE.SHELL.XTREAM_IMPORT_RESTORING_FAVORITES'
                );
            case 'restoring-recently-viewed':
                return this.translateText(
                    'WORKSPACE.SHELL.XTREAM_IMPORT_RESTORING_RECENT'
                );
            default:
                return '';
        }
    });
    readonly showXtreamImportOverlay = computed(() => {
        const context = this.currentContext();
        const section = this.currentSection();

        if (context?.provider !== 'xtreams') {
            return false;
        }

        return (
            this.xtreamStore.isImporting() &&
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
            placeholderKey: this.resolveSearchPlaceholderKey(
                route.kind,
                context,
                section
            ),
            scopeLabel: this.resolveSearchScopeLabel(
                route.kind,
                context,
                section
            ),
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

        return this.translateRailLinks(
            buildPortalRailLinks({
                provider: context.provider,
                playlistId: context.playlistId,
                isElectron: this.isElectron,
                workspace: true,
            }).primary,
            context.provider
        );
    });
    readonly secondaryContextLinks = computed<PortalRailLink[]>(() => {
        this.languageTick();

        const context = this.railContext();
        if (!context) {
            return [];
        }

        return this.translateRailLinks(
            buildPortalRailLinks({
                provider: context.provider,
                playlistId: context.playlistId,
                isElectron: this.isElectron,
                workspace: true,
            }).secondary.filter((link) => link.section !== 'downloads'),
            context.provider
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

            if (section === 'vod' || section === 'series') {
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
                (section !== 'vod' && section !== 'series' && section !== 'itv')
            ) {
                return;
            }

            this.stalkerStore.setSearchPhrase(term);
        });

        effect(() => {
            if (!this.currentRoute().usesQuerySearch) {
                return;
            }

            this.syncSearchQueryParam(this.appliedSearchQuery());
        });
    }

    closeActiveExternalSession(): void {
        void this.externalPlayback.closeSession(
            this.externalPlayback.activeSession()
        );
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

    openAddPlaylistDialog(type: PlaylistType): void {
        this.workspaceActions.openAddPlaylistDialog(type);
    }

    openCommandPalette(): void {
        const dialogRef = this.dialog.open<
            WorkspaceCommandPaletteComponent,
            { commands: WorkspaceCommandItem[]; query: string },
            WorkspaceCommandSelection | undefined
        >(WorkspaceCommandPaletteComponent, {
            width: 'min(760px, 92vw)',
            maxWidth: '92vw',
            panelClass: 'workspace-command-palette-overlay',
            autoFocus: false,
            data: {
                commands: this.getCommandPaletteItems(),
                query: this.searchQuery(),
            },
        });

        dialogRef
            .afterClosed()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((selection) => {
                if (!selection) {
                    return;
                }

                this.runCommandPaletteAction(selection);
            });
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
            this.bumpRefreshQueryParam();
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
            this.bumpRefreshQueryParam();
        }
    }

    navigateToGlobalFavorites(): void {
        const context = this.railContext();
        if (
            context &&
            (context.provider === 'xtreams' || context.provider === 'stalker')
        ) {
            void this.router.navigate(
                [
                    '/workspace',
                    context.provider,
                    context.playlistId,
                    'favorites',
                ],
                { queryParams: { scope: 'all' } }
            );
            return;
        }

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

    cancelXtreamImport(): void {
        void this.xtreamStore.cancelImport();
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

    private getCommandPaletteItems(): WorkspaceCommandItem[] {
        const availability: WorkspaceCommandAvailability = {
            context: this.currentContext(),
            dashboardXtreamContext: this.dashboardXtreamContext(),
            hasXtreamPlaylists: this.playlists().some(
                (playlist) => !!playlist.serverUrl
            ),
            isElectron: this.isElectron,
        };

        return WORKSPACE_COMMAND_DEFINITIONS.map((definition) => ({
            id: definition.id,
            label: this.translateText(definition.labelKey),
            description: this.translateText(definition.descriptionKey),
            scope: definition.scope,
            enabled: definition.isEnabled(availability),
        }));
    }

    private runCommandPaletteAction(
        selection: WorkspaceCommandSelection
    ): void {
        const query = selection.query.trim();

        if (selection.commandId === 'global-search') {
            this.openGlobalSearch(query);
            return;
        }

        if (selection.commandId === 'playlist-search') {
            this.openPlaylistSearchFromPalette(query);
            return;
        }

        if (selection.commandId === 'open-global-favorites') {
            this.navigateToGlobalFavorites();
            return;
        }

        if (selection.commandId === 'open-downloads') {
            this.openDownloadsShortcut();
            return;
        }

        if (selection.commandId === 'open-global-recent') {
            this.openGlobalRecent();
        }
    }

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
            this.setSearchState(this.getRouteQueryParam('q'));
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

    private syncSearchQueryParam(term: string): void {
        const nextTerm = term.trim();
        const currentTerm = this.getRouteQueryParam('q');
        if (nextTerm === currentTerm) {
            return;
        }

        const routePath = this.currentUrl().split('?')[0];
        const queryParams = {
            ...this.router.parseUrl(this.currentUrl()).queryParams,
        };

        if (nextTerm.length > 0) {
            queryParams['q'] = nextTerm;
        } else {
            delete queryParams['q'];
        }

        const queryString = this.toQueryString(queryParams);
        const nextUrl = queryString ? `${routePath}?${queryString}` : routePath;
        void this.router.navigateByUrl(nextUrl, { replaceUrl: true });
    }

    private getRouteQueryParam(name: string): string {
        const value = this.router.parseUrl(this.currentUrl()).queryParams[name];
        return typeof value === 'string' ? value : '';
    }

    private toQueryString(queryParams: Record<string, unknown>): string {
        const urlSearchParams = new URLSearchParams();

        Object.entries(queryParams).forEach(([key, value]) => {
            if (value == null) {
                return;
            }

            if (Array.isArray(value)) {
                value.forEach((item) =>
                    urlSearchParams.append(key, String(item))
                );
                return;
            }

            urlSearchParams.set(key, String(value));
        });

        return urlSearchParams.toString();
    }

    private bumpRefreshQueryParam(): void {
        const routePath = this.currentUrl().split('?')[0];
        const queryParams = {
            ...this.router.parseUrl(this.currentUrl()).queryParams,
            refresh: Date.now().toString(),
        };

        const queryString = this.toQueryString(queryParams);
        const nextUrl = queryString ? `${routePath}?${queryString}` : routePath;
        void this.router.navigateByUrl(nextUrl, { replaceUrl: true });
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

    private getProviderFromPlaylist(playlist: {
        serverUrl?: string;
        macAddress?: string;
    }): WorkspacePortalContext['provider'] {
        if (playlist.serverUrl) {
            return 'xtreams';
        }
        if (playlist.macAddress) {
            return 'stalker';
        }
        return 'playlists';
    }

    private resolveSearchPlaceholderKey(
        kind: WorkspaceShellPageKind,
        context: WorkspacePortalContext | null,
        section: PortalRailSection | null
    ): string {
        if (kind === 'sources') {
            return SEARCH_SOURCES_PLACEHOLDER;
        }

        if (kind === 'dashboard' || section === 'search') {
            return SEARCH_PLAYLIST_PLACEHOLDER;
        }

        if (
            context &&
            (section === 'vod' ||
                section === 'series' ||
                section === 'live' ||
                section === 'itv')
        ) {
            return SEARCH_SECTION_PLACEHOLDER;
        }

        return FILTER_SECTION_PLACEHOLDER;
    }

    private resolveSearchScopeLabel(
        kind: WorkspaceShellPageKind,
        context: WorkspacePortalContext | null,
        section: PortalRailSection | null
    ): string {
        if (kind === 'sources') {
            return this.translateText('WORKSPACE.SHELL.RAIL_SOURCES');
        }

        if (kind === 'global-favorites') {
            return this.translateText('HOME.PLAYLISTS.GLOBAL_FAVORITES');
        }

        if (kind === 'global-recent') {
            return this.translateText('PORTALS.RECENTLY_VIEWED');
        }

        if (kind === 'downloads') {
            return this.translateText('WORKSPACE.SHELL.RAIL_DOWNLOADS');
        }

        if (kind === 'dashboard' || section === 'search') {
            return this.translateText('WORKSPACE.SHELL.RAIL_SEARCH');
        }

        if (!context || !section) {
            return '';
        }

        if (
            section === 'vod' ||
            section === 'series' ||
            section === 'live' ||
            section === 'itv'
        ) {
            const categoryLabel = this.resolveActiveCategoryLabel(
                context,
                section
            );
            const sectionLabel = this.translateRailSection(section);

            return categoryLabel
                ? `${sectionLabel} / ${categoryLabel}`
                : sectionLabel;
        }

        return this.translateRailSection(section);
    }

    private resolveActiveCategoryLabel(
        context: WorkspacePortalContext,
        section: PortalRailSection
    ): string {
        if (context.provider === 'xtreams') {
            const category = this.xtreamStore.getSelectedCategory();
            return (
                category?.category_name ??
                category?.name ??
                this.translateRailSection(section)
            );
        }

        if (context.provider === 'stalker') {
            return (
                this.stalkerStore.getSelectedCategoryName().trim() ||
                this.translateRailSection(section)
            );
        }

        return this.translateRailSection(section);
    }

    private translateRailSection(section: PortalRailSection): string {
        return this.translateText(this.getRailTooltipKey('playlists', section));
    }

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }

    private translateRailLinks(
        links: PortalRailLink[],
        provider: WorkspacePortalContext['provider']
    ): PortalRailLink[] {
        return links.map((link) => ({
            ...link,
            tooltip: this.translateText(
                this.getRailTooltipKey(provider, link.section)
            ),
        }));
    }

    private getRailTooltipKey(
        provider: WorkspacePortalContext['provider'],
        section?: PortalRailSection
    ): string {
        if (provider === 'xtreams' && section === 'library') {
            return 'WORKSPACE.SHELL.RAIL_LIBRARY';
        }

        return (
            (section ? RAIL_TOOLTIP_KEYS[section] : null) ??
            'WORKSPACE.SHELL.RAIL_CONTEXT_ACTIONS'
        );
    }
}
