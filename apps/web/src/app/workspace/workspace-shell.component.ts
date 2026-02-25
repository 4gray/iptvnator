import {
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import {
    NavigationEnd,
    Router,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
} from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    AddPlaylistMenuComponent,
    PlaylistInfoComponent,
    PlaylistSwitcherComponent,
    PlaylistType,
    ResizableDirective,
} from 'components';
import {
    selectActivePlaylist,
    selectAllPlaylistsMeta,
    selectPlaylistTitle,
} from 'm3u-state';
import { filter, firstValueFrom } from 'rxjs';
import { PlaylistsService } from 'services';
import { GLOBAL_FAVORITES_PLAYLIST_ID } from 'shared-interfaces';
import { DownloadsService } from '../services/downloads.service';
import { AddPlaylistDialogComponent } from '../shared/components/add-playlist/add-playlist-dialog.component';
import {
    buildPortalRailLinks,
    PortalRailLink,
} from '../shared/navigation/portal-rail-links';
import { PortalRailLinksComponent } from '../shared/navigation/portal-rail-links.component';
import { AccountInfoComponent } from '../xtream-electron/account-info/account-info.component';
import { XtreamCategorySortMode } from '../xtream-electron/stores/features/with-selection.feature';
import { XtreamStore } from '../xtream-electron/stores/xtream.store';
import { FavoritesContextService } from './favorites-context.service';
import { SettingsContextService } from './settings-context.service';
import { WorkspaceContextPanelComponent } from './workspace-context-panel.component';
import { WorkspaceFavoritesContextPanelComponent } from './workspace-favorites-context-panel.component';
import { WorkspaceSettingsContextPanelComponent } from './workspace-settings-context-panel.component';
import { WorkspaceSourcesFiltersPanelComponent } from './workspace-sources-filters-panel.component';

interface WorkspaceContext {
    provider: 'xtreams' | 'stalker' | 'playlists';
    playlistId: string;
}

interface WorkspaceHeaderBulkAction {
    icon: string;
    tooltip: string;
    ariaLabel: string;
    disabled: boolean;
}

const XTREAM_CATEGORY_SORT_STORAGE_KEY = 'xtream-category-sort-mode';
const SEARCH_INPUT_DEBOUNCE_MS = 350;

@Component({
    selector: 'app-workspace-shell',
    imports: [
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatTooltip,
        AddPlaylistMenuComponent,
        PlaylistSwitcherComponent,
        TranslatePipe,
        RouterLink,
        RouterLinkActive,
        RouterOutlet,
        WorkspaceContextPanelComponent,
        WorkspaceFavoritesContextPanelComponent,
        WorkspaceSettingsContextPanelComponent,
        WorkspaceSourcesFiltersPanelComponent,
        PortalRailLinksComponent,
        ResizableDirective,
    ],
    templateUrl: './workspace-shell.component.html',
    styleUrl: './workspace-shell.component.scss',
})
export class WorkspaceShellComponent {
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly destroyRef = inject(DestroyRef);
    private readonly downloadsService = inject(DownloadsService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly dialog = inject(MatDialog);
    readonly favoritesCtx = inject(FavoritesContextService);
    readonly settingsCtx = inject(SettingsContextService);

    private searchDebounceTimeoutId: ReturnType<typeof setTimeout> | null =
        null;

    readonly addPlaylistMenu = viewChild.required(AddPlaylistMenuComponent);

    readonly playlistTitle = this.store.selectSignal(selectPlaylistTitle);
    private readonly activePlaylist =
        this.store.selectSignal(selectActivePlaylist);
    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );

    readonly searchQuery = signal('');
    readonly appliedSearchQuery = signal('');
    readonly lastM3uPlaylistId = signal<string | null>(null);
    readonly isElectron = !!window.electron;
    readonly isMacOS = window.electron?.platform === 'darwin';
    readonly workspaceLinks: PortalRailLink[] = [
        {
            icon: 'dashboard',
            tooltip: 'Dashboard',
            path: ['/workspace/dashboard'],
            exact: true,
        },
        {
            icon: 'library_books',
            tooltip: 'Sources',
            path: ['/workspace/sources'],
        },
    ];
    readonly currentUrl = signal(this.router.url);
    readonly currentContext = computed<WorkspaceContext | null>(() =>
        this.parseWorkspaceContext(this.currentUrl())
    );
    readonly currentSection = computed<string | null>(() =>
        this.parseWorkspaceSection(this.currentUrl())
    );
    readonly railContext = computed<WorkspaceContext | null>(() => {
        const routeContext = this.currentContext();
        if (routeContext) {
            return routeContext;
        }

        // On dashboard, sources, and settings we still want provider-specific rail links
        // for the currently active playlist selected in the switcher.
        if (
            !this.isDashboardRoute() &&
            !this.isSourcesRoute() &&
            !this.isSettingsRoute()
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
    readonly isDashboardRoute = computed(() =>
        /^\/workspace(?:\/dashboard)?(?:\/)?(?:\?.*)?$/.test(this.currentUrl())
    );
    readonly isSourcesRoute = computed(() =>
        /^\/workspace\/sources(?:\/)?(?:\?.*)?$/.test(this.currentUrl())
    );
    readonly isSettingsRoute = computed(() =>
        /^\/workspace\/settings(?:\/)?(?:\?.*)?$/.test(this.currentUrl())
    );
    readonly dashboardXtreamContext = computed<WorkspaceContext | null>(() => {
        if (!this.isDashboardRoute()) {
            return null;
        }

        const context = this.railContext();
        if (!context || context.provider !== 'xtreams') {
            return null;
        }

        return context;
    });
    readonly isCategoryContextRoute = computed(() => {
        const context = this.currentContext();
        const section = this.currentSection();
        return (
            !!context &&
            ((context.provider === 'xtreams' &&
                (section === 'vod' ||
                    section === 'series' ||
                    section === 'live')) ||
                (context.provider === 'stalker' &&
                    (section === 'vod' ||
                        section === 'series' ||
                        section === 'itv')))
        );
    });
    readonly isFavoritesContextRoute = computed(() => {
        const context = this.currentContext();
        const section = this.currentSection();
        if (!context) return false;
        return (
            (context.provider === 'xtreams' ||
                context.provider === 'stalker') &&
            (section === 'favorites' ||
                section === 'recent' ||
                section === 'downloads')
        );
    });
    readonly showContextPanel = computed(
        () =>
            this.isSourcesRoute() ||
            this.isSettingsRoute() ||
            this.isCategoryContextRoute() ||
            this.isFavoritesContextRoute()
    );
    readonly isFavoritesView = computed(() => {
        const context = this.currentContext();
        if (
            context?.provider === 'playlists' &&
            context.playlistId === GLOBAL_FAVORITES_PLAYLIST_ID
        ) {
            return true;
        }

        return this.currentSection() === 'favorites';
    });
    readonly canUseSearch = computed(() => {
        if (this.isSettingsRoute()) {
            return false;
        }

        if (this.isSourcesRoute()) {
            return true;
        }

        if (this.dashboardXtreamContext()) {
            return true;
        }

        const context = this.currentContext();
        const section = this.currentSection();
        if (context?.provider === 'xtreams') {
            return (
                section === 'vod' ||
                section === 'series' ||
                section === 'search' ||
                this.usesRouteQuerySearch(context, section)
            );
        }

        return context?.provider === 'stalker';
    });
    readonly searchPlaceholder = computed(() => {
        if (this.isSourcesRoute()) {
            return 'Search sources...';
        }

        const context = this.currentContext();
        const section = this.currentSection();

        if (!context) {
            if (this.dashboardXtreamContext()) {
                return 'Search in active playlist...';
            }
            return 'Search channels, movies, series...';
        }

        if (context.provider === 'xtreams') {
            if (section === 'search') {
                return 'Search in playlist content...';
            }
            if (section === 'vod' || section === 'series') {
                return 'Search in current category...';
            }
            if (section === 'favorites') {
                return 'Filter favorites...';
            }
            if (section === 'recent') {
                return 'Filter recently viewed...';
            }
            if (section === 'recently-added') {
                return 'Filter recently added...';
            }
            if (section === 'downloads') {
                return 'Filter downloads...';
            }
        }

        if (context.provider === 'stalker') {
            if (section === 'search') {
                return 'Search movies and series in this portal...';
            }
            if (section === 'favorites') {
                return 'Filter favorites...';
            }
            if (section === 'recent') {
                return 'Filter recently viewed...';
            }
            return 'Search this portal...';
        }

        return 'Search is not available for this section';
    });
    readonly canSort = computed(() => {
        const context = this.currentContext();
        const section = this.currentSection();
        return context?.provider === 'xtreams'
            ? section === 'vod' || section === 'series'
            : false;
    });
    readonly contentSortMode = this.xtreamStore.contentSortMode;
    readonly contentSortLabel = computed(() => {
        const mode = this.contentSortMode();
        if (mode === 'date-asc') return 'Date Added (Oldest First)';
        if (mode === 'name-asc') return 'Name A-Z';
        if (mode === 'name-desc') return 'Name Z-A';
        return 'Date Added (Latest First)';
    });
    readonly primaryContextLinks = computed<PortalRailLink[]>(() => {
        const context = this.railContext();
        if (!context) return [];
        return buildPortalRailLinks({
            provider: context.provider,
            playlistId: context.playlistId,
            isElectron: this.isElectron,
            workspace: true,
        }).primary;
    });
    readonly secondaryContextLinks = computed<PortalRailLink[]>(() => {
        const context = this.railContext();
        if (!context) return [];
        return buildPortalRailLinks({
            provider: context.provider,
            playlistId: context.playlistId,
            isElectron: this.isElectron,
            workspace: true,
        }).secondary.filter((link) => link.section !== 'downloads');
    });
    readonly downloadsContext = computed<WorkspaceContext | null>(() => {
        if (!this.isElectron) {
            return null;
        }

        const context = this.currentContext() ?? this.railContext();
        if (
            !context ||
            (context.provider !== 'xtreams' && context.provider !== 'stalker')
        ) {
            return null;
        }

        return context;
    });
    readonly isDownloadsView = computed(
        () => this.currentSection() === 'downloads'
    );
    readonly canOpenPlaylistInfo = computed(() =>
        Boolean(this.activePlaylist())
    );
    readonly canOpenAccountInfo = computed(() =>
        Boolean(this.activePlaylist()?.serverUrl)
    );
    readonly headerBulkAction = computed<WorkspaceHeaderBulkAction | null>(
        () => {
            const context = this.currentContext();
            const section = this.currentSection();
            if (!context || !section) {
                return null;
            }

            if (
                (context.provider === 'xtreams' ||
                    context.provider === 'stalker') &&
                section === 'downloads'
            ) {
                const hasClearable = this.downloadsService
                    .downloads()
                    .some(
                        (item) =>
                            item.playlistId === context.playlistId &&
                            (item.status === 'completed' ||
                                item.status === 'failed' ||
                                item.status === 'canceled')
                    );
                return {
                    icon: 'delete_sweep',
                    tooltip: 'Clear completed downloads',
                    ariaLabel: 'Clear completed downloads',
                    disabled: !hasClearable,
                };
            }

            if (context.provider === 'xtreams' && section === 'recent') {
                return {
                    icon: 'delete_sweep',
                    tooltip: 'Clear recently viewed',
                    ariaLabel: 'Clear recently viewed',
                    disabled: this.xtreamStore.recentItems().length === 0,
                };
            }

            if (context.provider === 'stalker' && section === 'recent') {
                return {
                    icon: 'delete_sweep',
                    tooltip: 'Clear recently viewed',
                    ariaLabel: 'Clear recently viewed',
                    disabled: false,
                };
            }

            return null;
        }
    );

    constructor() {
        this.destroyRef.onDestroy(() => {
            if (this.searchDebounceTimeoutId !== null) {
                clearTimeout(this.searchDebounceTimeoutId);
                this.searchDebounceTimeoutId = null;
            }
        });

        const savedSortMode = localStorage.getItem(
            XTREAM_CATEGORY_SORT_STORAGE_KEY
        );
        if (
            savedSortMode === 'date-desc' ||
            savedSortMode === 'date-asc' ||
            savedSortMode === 'name-asc' ||
            savedSortMode === 'name-desc'
        ) {
            this.xtreamStore.setContentSortMode(savedSortMode);
        }

        this.router.events
            .pipe(
                filter(
                    (event): event is NavigationEnd =>
                        event instanceof NavigationEnd
                ),
                takeUntilDestroyed()
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

            if (context?.provider === 'stalker' && section === 'search') {
                this.syncStalkerSearchQueryParam(term);
            }
        });

        effect(() => {
            const context = this.currentContext();
            const section = this.currentSection();
            const useQuerySearch =
                this.isSourcesRoute() ||
                this.usesRouteQuerySearch(context, section);

            if (!useQuerySearch) {
                return;
            }

            this.syncSearchQueryParam(this.appliedSearchQuery());
        });

        effect(() => {
            const context = this.currentContext();
            if (!context || context.provider !== 'playlists') {
                return;
            }

            if (context.playlistId !== GLOBAL_FAVORITES_PLAYLIST_ID) {
                this.lastM3uPlaylistId.set(context.playlistId);
            }
        });
    }

    readonly playlistSubtitle = computed(() => {
        const active = this.activePlaylist();
        if (active?.serverUrl) return 'Xtream Code';
        if (active?.macAddress) return 'Stalker Portal';
        if (active?.count) return `${active.count} channels`;

        const sourcesCount = this.playlists().length;
        if (sourcesCount === 0) return 'No sources available';
        if (sourcesCount === 1) return '1 source available';
        return `${sourcesCount} sources available`;
    });

    onSearchInput(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const value = target?.value ?? '';
        this.searchQuery.set(value);
        this.scheduleSearchApply(value);
    }

    onSearchEnter(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        const value = (target?.value ?? this.searchQuery()).trim();
        this.searchQuery.set(value);

        if (!value) {
            this.applySearchQuery('');
            return;
        }

        // Dashboard + active Xtream source should jump into global playlist search.
        const dashboardXtream = this.dashboardXtreamContext();
        if (dashboardXtream) {
            event.preventDefault();
            this.xtreamStore.setSearchTerm(value);
            this.applySearchQuery(value);
            this.router.navigate(
                ['/workspace', 'xtreams', dashboardXtream.playlistId, 'search'],
                {
                    queryParams: { q: value },
                }
            );
            return;
        }

        // For other contexts, Enter applies immediately instead of waiting debounce.
        this.applySearchQuery(value);
    }

    openAddPlaylistDialog(type: PlaylistType): void {
        this.dialog.open<AddPlaylistDialogComponent, { type: PlaylistType }>(
            AddPlaylistDialogComponent,
            {
                width: '600px',
                data: { type },
            }
        );
    }

    async runHeaderBulkAction(): Promise<void> {
        const context = this.currentContext();
        const section = this.currentSection();
        if (!context || !section) {
            return;
        }

        if (
            (context.provider === 'xtreams' ||
                context.provider === 'stalker') &&
            section === 'downloads'
        ) {
            await this.downloadsService.clearCompleted(context.playlistId);
            await this.downloadsService.loadDownloads(context.playlistId);
            return;
        }

        if (context.provider === 'xtreams' && section === 'recent') {
            this.xtreamStore.clearRecentItems({ id: context.playlistId });
            return;
        }

        if (context.provider === 'stalker' && section === 'recent') {
            await firstValueFrom(
                this.playlistsService.clearPortalRecentlyViewed(
                    context.playlistId
                )
            );
            this.bumpRefreshQueryParam();
        }
    }

    toggleFavoritesShortcut(): void {
        const context = this.currentContext();
        if (!context) return;

        if (context.provider === 'xtreams') {
            if (!this.isElectron) return;

            const base = ['/workspace', 'xtreams', context.playlistId];
            this.router.navigate(
                this.isFavoritesView()
                    ? [...base, 'vod']
                    : [...base, 'favorites']
            );
            return;
        }

        if (context.provider === 'stalker') {
            const base = ['/workspace', 'stalker', context.playlistId];
            this.router.navigate(
                this.isFavoritesView()
                    ? [...base, 'vod']
                    : [...base, 'favorites']
            );
            return;
        }

        if (context.provider === 'playlists') {
            if (context.playlistId === GLOBAL_FAVORITES_PLAYLIST_ID) {
                const fallbackPlaylist = this.lastM3uPlaylistId();
                if (fallbackPlaylist) {
                    this.router.navigate([
                        '/workspace',
                        'playlists',
                        fallbackPlaylist,
                    ]);
                } else {
                    this.router.navigate(['/workspace', 'dashboard']);
                }
                return;
            }

            this.router.navigate([
                '/workspace',
                'playlists',
                GLOBAL_FAVORITES_PLAYLIST_ID,
            ]);
        }
    }

    openDownloadsShortcut(): void {
        const context = this.downloadsContext();
        if (!context) {
            return;
        }

        this.router.navigate([
            '/workspace',
            context.provider,
            context.playlistId,
            'downloads',
        ]);
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

        this.dialog.open(AccountInfoComponent, {
            width: '80%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            data: {
                vodStreamsCount: this.xtreamStore.vodStreams().length,
                liveStreamsCount: this.xtreamStore.liveStreams().length,
                seriesCount: this.xtreamStore.serialStreams().length,
            },
        });
    }

    setContentSortMode(mode: XtreamCategorySortMode): void {
        this.xtreamStore.setContentSortMode(mode);
        localStorage.setItem(XTREAM_CATEGORY_SORT_STORAGE_KEY, mode);
    }

    private parseWorkspaceContext(url: string): WorkspaceContext | null {
        const match = url.match(
            /^\/workspace\/(xtreams|stalker|playlists)\/([^\/\?]+)/
        );
        if (!match) return null;

        return {
            provider: match[1] as WorkspaceContext['provider'],
            playlistId: match[2],
        };
    }

    private parseWorkspaceSection(url: string): string | null {
        const match = url.match(
            /^\/workspace\/(?:xtreams|stalker|playlists)\/[^\/\?]+\/([^\/\?]+)/
        );
        if (!match) return null;
        return match[1];
    }

    private syncSearchFromRoute(): void {
        const context = this.currentContext();
        const section = this.currentSection();

        if (context?.provider === 'xtreams') {
            if (section === 'search') {
                const queryTerm = this.getRouteQueryParam('q');
                this.setSearchState(queryTerm || this.xtreamStore.searchTerm());
                return;
            }
            if (section === 'vod' || section === 'series') {
                this.setSearchState(this.xtreamStore.categorySearchTerm());
                return;
            }
        }

        if (context?.provider === 'stalker' && section === 'search') {
            this.setSearchState(this.getRouteQueryParam('q'));
            return;
        }

        if (
            this.isSourcesRoute() ||
            this.usesRouteQuerySearch(context, section)
        ) {
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

        const context = this.currentContext();
        if (
            context?.provider === 'stalker' &&
            this.currentSection() !== 'search' &&
            !this.usesRouteQuerySearch(context, this.currentSection()) &&
            value.trim().length > 0
        ) {
            this.router.navigate(
                ['/workspace', 'stalker', context.playlistId, 'search'],
                {
                    queryParams: {
                        q: value.trim(),
                    },
                }
            );
        }
    }

    private syncStalkerSearchQueryParam(term: string): void {
        const nextTerm = term.trim();
        const currentTerm = this.getRouteQueryParam('q');

        if (nextTerm === currentTerm) {
            return;
        }

        this.syncSearchQueryParam(nextTerm);
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
        this.router.navigateByUrl(nextUrl, { replaceUrl: true });
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
        this.router.navigateByUrl(nextUrl, { replaceUrl: true });
    }

    private usesRouteQuerySearch(
        context: WorkspaceContext | null,
        section: string | null
    ): boolean {
        if (!context || !section) {
            return false;
        }

        if (context.provider === 'xtreams') {
            return (
                section === 'favorites' ||
                section === 'downloads' ||
                section === 'recent' ||
                section === 'recently-added'
            );
        }

        if (context.provider === 'stalker') {
            return section === 'favorites' || section === 'recent';
        }

        return false;
    }

    private getProviderFromPlaylist(playlist: {
        serverUrl?: string;
        macAddress?: string;
    }): WorkspaceContext['provider'] {
        if (playlist.serverUrl) {
            return 'xtreams';
        }
        if (playlist.macAddress) {
            return 'stalker';
        }
        return 'playlists';
    }
}
