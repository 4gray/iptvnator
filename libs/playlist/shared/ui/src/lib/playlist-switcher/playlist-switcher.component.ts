import { DatePipe, DOCUMENT } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatRippleModule } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenu, MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistContextFacade,
    PlaylistRefreshActionService,
} from '@iptvnator/playlist/shared/util';
import {
    DatabaseService,
    PortalStatus,
    PortalStatusService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { startWith } from 'rxjs';
import { PlaylistInfoComponent } from '../recent-playlists/playlist-info/playlist-info.component';

type PlaylistFilterType = 'm3u' | 'stalker' | 'xtream';

const SEARCH_QUERY_STORAGE_KEY = 'playlist-switcher:search-query';
const PLAYLIST_TYPE_FILTER_STORAGE_KEY = 'playlist-switcher:type-filters';
const DEFAULT_PLAYLIST_TYPE_FILTERS: Record<PlaylistFilterType, boolean> = {
    m3u: true,
    stalker: true,
    xtream: true,
};

@Component({
    selector: 'app-playlist-switcher',
    templateUrl: './playlist-switcher.component.html',
    styleUrls: ['./playlist-switcher.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DatePipe,
        FormsModule,
        MatDivider,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatMenuModule,
        MatRippleModule,
        MatTooltip,
        TranslatePipe,
    ],
})
export class PlaylistSwitcherComponent {
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly portalStatusService = inject(PortalStatusService);
    private readonly translate = inject(TranslateService);
    private readonly refreshAction = inject(PlaylistRefreshActionService);
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly databaseService = inject(DatabaseService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private focusSearchTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly currentTitle = input.required<string>();
    readonly subtitle = input<string>('');
    readonly showPlaylistInfo = input(false);
    readonly showAccountInfo = input(false);
    readonly showAddPlaylist = input(false);
    readonly canRefreshActivePlaylist = input(false);
    readonly isRefreshingActivePlaylist = input(false);
    readonly playlistSelected = output<string>();
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();

    onRefreshClick(event: Event): void {
        event.stopPropagation();
        event.preventDefault();
        this.refreshPlaylistRequested.emit();
    }

    readonly menuTrigger = viewChild.required<MatMenuTrigger>('menuTrigger');
    readonly playlistMenu = viewChild.required<MatMenu>('playlistMenu');
    readonly triggerElement =
        viewChild.required<ElementRef<HTMLElement>>('triggerElement');
    readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');

    readonly isMenuOpen = signal(false);
    readonly searchQuery = signal(this.readPersistedSearchQuery());
    readonly playlistTypeFilters = signal(this.readPersistedTypeFilters());
    readonly searchExpanded = signal(false);
    private static readonly SEARCH_AUTO_VISIBLE_THRESHOLD = 5;

    readonly playlists = this.playlistContext.playlists;
    readonly allPlaylistsLoaded = this.playlistContext.allPlaylistsLoaded;
    readonly activePlaylistId = this.playlistContext.resolvedPlaylistId;
    readonly activePlaylist = this.playlistContext.activePlaylist;
    readonly filteredPlaylists = computed(() => {
        const query = this.searchQuery().toLowerCase().trim();
        const filters = this.playlistTypeFilters();
        const allPlaylists = this.playlists();
        const filteredByType = allPlaylists.filter((playlist) => {
            const playlistType = this.getPlaylistFilterType(playlist);
            return filters[playlistType];
        });
        const filtered = query
            ? filteredByType.filter(
                  (playlist) =>
                      playlist.title?.toLowerCase().includes(query) ||
                      playlist.filename?.toLowerCase().includes(query)
              )
            : filteredByType;

        return [...filtered].sort(
            (a, b) =>
                new Date(b.importDate ?? 0).getTime() -
                new Date(a.importDate ?? 0).getTime()
        );
    });
    readonly displayTitle = computed(() => {
        if (!this.activePlaylistId()) {
            return 'Select playlist';
        }

        return (
            this.currentTitle() ||
            this.activePlaylist()?.title ||
            this.activePlaylist()?.filename ||
            this.activePlaylist()?.url ||
            this.activePlaylist()?.portalUrl ||
            'Untitled playlist'
        );
    });

    readonly availablePlaylistTypes = computed(() => {
        const types = new Set<PlaylistFilterType>();
        for (const playlist of this.playlists()) {
            types.add(this.getPlaylistFilterType(playlist));
        }
        return types;
    });
    readonly showTypeFilters = computed(
        () => this.availablePlaylistTypes().size > 1
    );
    readonly hasSearchToggle = computed(
        () =>
            this.playlists().length <=
            PlaylistSwitcherComponent.SEARCH_AUTO_VISIBLE_THRESHOLD
    );
    readonly showSearchField = computed(
        () => !this.hasSearchToggle() || this.searchExpanded()
    );

    readonly portalStatuses = signal<Map<string, PortalStatus>>(new Map());

    /**
     * Tracks the in-flight check round so we can cancel pending writes when
     * the menu closes (avoiding zombie writes from a slow portal landing
     * after the user has moved on). Status caching itself lives in
     * PortalStatusService so it's shared across components.
     */
    private portalStatusAbortController: AbortController | null = null;
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.clearMenuOverlayWidth();
            this.clearSearchFocusTimeout();
            this.cancelPortalStatusChecks();
        });
    }

    onMenuOpened(): void {
        this.isMenuOpen.set(true);
        this.syncMenuOverlayWidthToTrigger();
        if (this.showSearchField()) {
            this.focusSearchField();
        }
        void this.checkPortalStatuses(this.playlists());
    }

    onMenuClosed(): void {
        this.isMenuOpen.set(false);
        this.clearMenuOverlayWidth();
        this.clearSearchFocusTimeout();
        this.cancelPortalStatusChecks();
        if (this.hasSearchToggle()) {
            this.searchExpanded.set(false);
        }
    }

    toggleSearchField(event?: Event): void {
        event?.stopPropagation();
        const next = !this.searchExpanded();
        this.searchExpanded.set(next);
        if (next) {
            this.focusSearchField();
        }
    }

    setSearchQuery(value: string): void {
        this.searchQuery.set(value);
        this.writePersistedSearchQuery(value);
    }

    togglePlaylistTypeFilter(type: PlaylistFilterType, event?: Event): void {
        event?.stopPropagation();
        const current = this.playlistTypeFilters();
        const next = {
            ...current,
            [type]: !current[type],
        };

        if (!next.m3u && !next.stalker && !next.xtream) {
            return;
        }

        this.playlistTypeFilters.set(next);
        this.writePersistedTypeFilters(next);
    }

    isTypeFilterSelected(type: PlaylistFilterType): boolean {
        return this.playlistTypeFilters()[type];
    }

    selectPlaylist(playlist: PlaylistMeta): void {
        this.menuTrigger().closeMenu();
        this.playlistContext.selectPlaylist(playlist);
        this.playlistSelected.emit(playlist._id);
    }

    requestPlaylistInfo(): void {
        this.menuTrigger().closeMenu();
        this.playlistInfoRequested.emit();
    }

    requestAccountInfo(): void {
        this.menuTrigger().closeMenu();
        this.accountInfoRequested.emit();
    }

    requestAddPlaylist(): void {
        this.menuTrigger().closeMenu();
        this.addPlaylistRequested.emit();
    }

    hasType(type: PlaylistFilterType): boolean {
        return this.availablePlaylistTypes().has(type);
    }

    canRefreshPlaylist(playlist: PlaylistMeta): boolean {
        return this.refreshAction.canRefresh(playlist);
    }

    openPlaylistInfoFor(playlist: PlaylistMeta, event?: Event): void {
        event?.stopPropagation();
        this.menuTrigger().closeMenu();
        this.dialog.open(PlaylistInfoComponent, { data: playlist });
    }

    refreshPlaylistFor(playlist: PlaylistMeta, event?: Event): void {
        event?.stopPropagation();
        this.menuTrigger().closeMenu();
        this.refreshAction.refresh(playlist);
    }

    removePlaylistFor(playlist: PlaylistMeta, event?: Event): void {
        event?.stopPropagation();
        this.menuTrigger().closeMenu();
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            onConfirm: () => this.removePlaylistConfirmed(playlist),
        });
    }

    private async removePlaylistConfirmed(
        playlist: PlaylistMeta
    ): Promise<void> {
        const operationId = playlist.serverUrl
            ? this.databaseService.createOperationId('playlist-delete')
            : undefined;

        const deleted = await this.databaseService.deletePlaylist(
            playlist._id,
            operationId ? { operationId } : undefined
        );

        if (!deleted) {
            return;
        }

        this.store.dispatch(
            PlaylistActions.removePlaylist({ playlistId: playlist._id })
        );
        this.snackBar.open(
            this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS'),
            undefined,
            { duration: 2000 }
        );
    }

    getPlaylistIcon(playlist: PlaylistMeta): string {
        if (playlist.macAddress) {
            return 'dashboard';
        }
        if (playlist.serverUrl) {
            return 'public';
        }
        if (playlist.url) {
            return 'cloud';
        }
        return 'folder';
    }

    getPlaylistTypeLabel(playlist: PlaylistMeta): string {
        if (playlist.macAddress) {
            return 'Stalker Portal';
        }
        if (playlist.serverUrl) {
            return 'Xtream Code';
        }
        return `${playlist.count} channels`;
    }

    getPlaylistMetaLabel(playlist: PlaylistMeta): string {
        const count = playlist.count ?? 0;
        const channelsLabel = this.translate.instant(
            'HOME.PLAYLISTS.CHANNELS_COUNT',
            { count }
        );
        const fallback = `${count} channels`;
        const countLabel =
            channelsLabel && channelsLabel !== 'HOME.PLAYLISTS.CHANNELS_COUNT'
                ? channelsLabel
                : fallback;

        if (playlist.macAddress) {
            return 'Stalker Portal';
        }
        if (playlist.serverUrl) {
            return 'Xtream Code';
        }
        return countLabel;
    }

    getStatusClass(playlistId: string): string {
        const status = this.portalStatuses().get(playlistId);
        // No entry yet means we haven't checked (or are mid-flight without a
        // 'checking' write). Render no status class instead of misleading the
        // user with the red 'unavailable' dot.
        if (!status) {
            return '';
        }
        return this.portalStatusService.getStatusClass(status);
    }

    isSelected(playlist: PlaylistMeta): boolean {
        return this.activePlaylistId() === playlist._id;
    }

    private getPlaylistFilterType(playlist: PlaylistMeta): PlaylistFilterType {
        if (playlist.macAddress) {
            return 'stalker';
        }
        if (playlist.serverUrl) {
            return 'xtream';
        }
        return 'm3u';
    }

    private async checkPortalStatuses(playlists: PlaylistMeta[]) {
        // Cancel any prior in-flight round so its results can't overwrite the
        // new round (e.g. user closes + reopens the menu rapidly).
        this.cancelPortalStatusChecks();
        const controller = new AbortController();
        this.portalStatusAbortController = controller;

        const xtreamPlaylists = playlists.filter(
            (playlist) =>
                playlist.serverUrl && playlist.username && playlist.password
        );
        if (xtreamPlaylists.length === 0) {
            return;
        }

        // Hydrate from the shared service cache + mark uncached portals as
        // 'checking' in a single signal write so the UI flips from blank →
        // cached/checking dots in one render, not one per playlist.
        const next = new Map(this.portalStatuses());
        const toFetch: PlaylistMeta[] = [];
        for (const playlist of xtreamPlaylists) {
            const cached = this.portalStatusService.getCachedStatus(
                playlist.serverUrl,
                playlist.username,
                playlist.password
            );
            if (cached !== null) {
                next.set(playlist._id, cached);
            } else {
                next.set(playlist._id, 'checking');
                toFetch.push(playlist);
            }
        }
        this.portalStatuses.set(next);

        if (toFetch.length === 0) {
            return;
        }

        // Stream results: each portal's dot updates as soon as ITS request
        // resolves, independent of the slowest one. Replaces the prior
        // Promise.all that blocked all dots on the tail latency.
        await Promise.all(
            toFetch.map(async (playlist) => {
                let status: PortalStatus;
                try {
                    status = await this.portalStatusService.checkPortalStatus(
                        playlist.serverUrl,
                        playlist.username,
                        playlist.password
                    );
                } catch {
                    status = 'unavailable';
                }

                if (controller.signal.aborted) {
                    return;
                }

                this.portalStatuses.update((current) => {
                    const updated = new Map(current);
                    updated.set(playlist._id, status);
                    return updated;
                });
            })
        );
    }

    private cancelPortalStatusChecks(): void {
        if (this.portalStatusAbortController) {
            this.portalStatusAbortController.abort();
            this.portalStatusAbortController = null;
        }
    }

    private syncMenuOverlayWidthToTrigger(): void {
        const triggerWidth = Math.round(
            this.triggerElement().nativeElement.getBoundingClientRect().width
        );
        const overlayWidth = Math.max(triggerWidth, 400);
        this.document.documentElement.style.setProperty(
            '--playlist-switcher-overlay-width',
            `${overlayWidth}px`
        );
    }

    private clearMenuOverlayWidth(): void {
        this.document.documentElement.style.removeProperty(
            '--playlist-switcher-overlay-width'
        );
    }

    private focusSearchField(): void {
        this.clearSearchFocusTimeout();
        this.focusSearchTimeoutId = setTimeout(() => {
            const input = this.searchInput()?.nativeElement;
            if (!input) {
                return;
            }
            input.focus();
            input.select();
            this.focusSearchTimeoutId = null;
        }, 0);
    }

    private clearSearchFocusTimeout(): void {
        if (this.focusSearchTimeoutId !== null) {
            clearTimeout(this.focusSearchTimeoutId);
            this.focusSearchTimeoutId = null;
        }
    }

    private readPersistedSearchQuery(): string {
        try {
            return localStorage.getItem(SEARCH_QUERY_STORAGE_KEY) ?? '';
        } catch {
            return '';
        }
    }

    private writePersistedSearchQuery(value: string): void {
        try {
            localStorage.setItem(SEARCH_QUERY_STORAGE_KEY, value);
        } catch {
            // Ignore storage write failures.
        }
    }

    private readPersistedTypeFilters(): Record<PlaylistFilterType, boolean> {
        try {
            const raw = localStorage.getItem(PLAYLIST_TYPE_FILTER_STORAGE_KEY);
            if (!raw) {
                return { ...DEFAULT_PLAYLIST_TYPE_FILTERS };
            }

            const parsed = JSON.parse(raw) as Partial<
                Record<PlaylistFilterType, boolean>
            >;
            const next = {
                m3u: parsed.m3u !== false,
                stalker: parsed.stalker !== false,
                xtream: parsed.xtream !== false,
            };

            if (!next.m3u && !next.stalker && !next.xtream) {
                return { ...DEFAULT_PLAYLIST_TYPE_FILTERS };
            }

            return next;
        } catch {
            return { ...DEFAULT_PLAYLIST_TYPE_FILTERS };
        }
    }

    private writePersistedTypeFilters(
        filters: Record<PlaylistFilterType, boolean>
    ): void {
        try {
            localStorage.setItem(
                PLAYLIST_TYPE_FILTER_STORAGE_KEY,
                JSON.stringify(filters)
            );
        } catch {
            // Ignore storage write failures.
        }
    }
}
