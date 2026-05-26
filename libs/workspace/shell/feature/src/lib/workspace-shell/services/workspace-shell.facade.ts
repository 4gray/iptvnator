import { computed, DestroyRef, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    WorkspaceHeaderContextService,
    WorkspaceResolvedCommandItem,
} from '@iptvnator/portal/shared/util';
import {
    DownloadsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    CommandBuilderActions,
    CommandBuilderContext,
} from './helpers/workspace-shell-command-builders';
import { WorkspaceShellCommandPaletteService } from './workspace-shell-command-palette.service';
import { WorkspaceShellHeaderService } from './workspace-shell-header.service';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';
import { WorkspaceShellSearchService } from './workspace-shell-search.service';
import { WorkspaceShellXtreamImportService } from './workspace-shell-xtream-import.service';

export type { WorkspaceHeaderBulkAction } from './helpers/workspace-shell-constants';

@Injectable()
export class WorkspaceShellFacade {
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly settingsStore = inject(SettingsStore);
    private readonly translate = inject(TranslateService);
    private readonly commandPalette = inject(
        WorkspaceShellCommandPaletteService
    );
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly downloadsService = inject(DownloadsService);
    private readonly routeState = inject(WorkspaceShellRouteStateService);
    private readonly search = inject(WorkspaceShellSearchService);
    private readonly header = inject(WorkspaceShellHeaderService);
    private readonly xtreamImport = inject(WorkspaceShellXtreamImportService);
    readonly headerContext = inject(WorkspaceHeaderContextService);

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
        if (!(event.ctrlKey || event.metaKey)) {
            return;
        }

        if (event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.openCommandPalette();
        }
    };

    readonly activePlaylist = this.routeState.activePlaylist;
    readonly playlists = this.routeState.playlists;
    readonly playlistTitle = this.header.playlistTitle;
    readonly hasNoPlaylists = this.routeState.hasNoPlaylists;
    readonly searchQuery = this.search.searchQuery;
    readonly appliedSearchQuery = this.search.appliedSearchQuery;
    readonly currentUrl = this.routeState.currentUrl;
    readonly currentRoute = this.routeState.currentRoute;
    readonly showDashboard = this.routeState.showDashboard;
    readonly brandLink = this.routeState.brandLink;
    readonly brandTooltipKey = this.routeState.brandTooltipKey;
    readonly brandAriaLabelKey = this.routeState.brandAriaLabelKey;
    readonly currentContext = this.routeState.currentContext;
    readonly currentSection = this.routeState.currentSection;
    readonly commandPaletteCommands = computed<WorkspaceResolvedCommandItem[]>(
        () => {
            this.languageTick();
            return this.commandPalette.buildPaletteCommands(
                this.makeCommandBuilderContext()
            );
        }
    );
    readonly workspaceLinks = this.routeState.workspaceLinks;
    readonly isDashboardRoute = this.routeState.isDashboardRoute;
    readonly isSourcesRoute = this.routeState.isSourcesRoute;
    readonly isSettingsRoute = this.routeState.isSettingsRoute;
    readonly isGlobalDownloadsRoute = this.routeState.isGlobalDownloadsRoute;
    readonly railContext = this.routeState.railContext;
    readonly externalPlaybackSession = this.externalPlayback.visibleSession;
    readonly showExternalPlaybackBar = computed(
        () => this.settingsStore.showExternalPlaybackBar?.() ?? true
    );
    readonly dashboardXtreamContext = this.routeState.dashboardXtreamContext;
    readonly contextPanel = this.routeState.contextPanel;
    readonly showContextPanel = this.routeState.showContextPanel;
    readonly showXtreamImportOverlay =
        this.xtreamImport.showXtreamImportOverlay;
    readonly searchCapability = this.search.searchCapability;
    readonly canUseSearch = this.search.canUseSearch;
    readonly searchPlaceholder = this.search.searchPlaceholder;
    readonly searchScopeLabel = this.search.searchScopeLabel;
    readonly searchStatusLabel = this.search.searchStatusLabel;
    readonly railProviderClass = this.routeState.railProviderClass;
    readonly primaryContextLinks = this.routeState.primaryContextLinks;
    readonly secondaryContextLinks = this.routeState.secondaryContextLinks;
    readonly isDownloadsView = this.routeState.isDownloadsView;
    readonly headerShortcut = this.header.headerShortcut;
    readonly canOpenPlaylistInfo = this.header.canOpenPlaylistInfo;
    readonly canOpenAccountInfo = this.header.canOpenAccountInfo;
    readonly canRefreshPlaylist = this.header.canRefreshPlaylist;
    readonly isRefreshingPlaylist = this.header.isRefreshingPlaylist;
    readonly headerBulkAction = this.header.headerBulkAction;
    readonly playlistSubtitle = this.header.playlistSubtitle;
    readonly hasActiveDownloads = computed(
        () => this.supportsDownloads && this.downloadsService.activeCount() > 0
    );

    constructor() {
        this.destroyRef.onDestroy(() => {
            document.removeEventListener('keydown', this.onDocumentKeydown);
        });

        document.addEventListener('keydown', this.onDocumentKeydown);
    }

    get isElectron(): boolean {
        return this.runtime.isElectron;
    }

    get isMacOS(): boolean {
        return this.runtime.isMacOS;
    }

    get supportsDownloads(): boolean {
        return this.runtime.supportsDownloads;
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
        this.search.onSearchInput(value);
    }

    onSearchEnter(value: string): void {
        this.search.onSearchEnter(value);
    }

    openAddPlaylistDialog(): void {
        this.header.openAddPlaylistDialog();
    }

    openCommandPalette(): void {
        this.commandPalette.openCommandPalette(
            this.makeCommandBuilderContext(),
            this.searchQuery()
        );
    }

    runHeaderBulkAction(): Promise<void> {
        return this.header.runHeaderBulkAction();
    }

    navigateToGlobalFavorites(): void {
        this.header.navigateToGlobalFavorites();
    }

    openDownloadsShortcut(): void {
        this.header.openDownloadsShortcut();
    }

    runHeaderShortcut(): void {
        this.header.runHeaderShortcut();
    }

    openGlobalSearch(initialQuery = ''): void {
        this.header.openGlobalSearch(initialQuery);
    }

    openGlobalRecent(): void {
        this.header.openGlobalRecent();
    }

    openPlaylistInfo(): void {
        this.header.openPlaylistInfo();
    }

    openAccountInfo(): void {
        this.header.openAccountInfo();
    }

    refreshCurrentPlaylist(): void {
        this.header.refreshCurrentPlaylist();
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
            supportsDownloads: this.supportsDownloads,
            showDashboard: this.showDashboard(),
            translate: (key, params) => this.translateText(key, params),
            router: this.router,
            actions: this.commandBuilderActions,
        };
    }

    private readonly commandBuilderActions: CommandBuilderActions = {
        openPlaylistSearch: (query) =>
            this.search.openPlaylistSearchFromPalette(query),
        refreshCurrentPlaylist: () => this.refreshCurrentPlaylist(),
        openPlaylistInfo: () => this.openPlaylistInfo(),
        openAccountInfo: () => this.openAccountInfo(),
        openGlobalSearch: (query) => this.openGlobalSearch(query),
        navigateToGlobalFavorites: () => this.navigateToGlobalFavorites(),
        openGlobalRecent: () => this.openGlobalRecent(),
        openDownloadsShortcut: () => this.openDownloadsShortcut(),
        openAddPlaylistDialog: (kind) =>
            this.header.openAddPlaylistDialog(kind),
    };

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
