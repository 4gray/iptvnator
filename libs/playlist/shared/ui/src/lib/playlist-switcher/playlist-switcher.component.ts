import { DatePipe, DOCUMENT } from '@angular/common';
import {
    Component,
    computed,
    DestroyRef,
    ElementRef,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatRippleModule } from '@angular/material/core';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenu, MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    PlaylistActions,
    selectActivePlaylistId,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from 'm3u-state';
import { filter } from 'rxjs';
import { PortalStatus, PortalStatusService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';

type PlaylistRouteProvider = 'playlists' | 'xtreams' | 'stalker';
type PlaylistSectionProvider = Exclude<PlaylistRouteProvider, 'playlists'>;
type PlaylistFilterType = 'm3u' | 'stalker' | 'xtream';

interface PlaylistRouteContext {
    inWorkspace: boolean;
    isWorkspaceDashboard: boolean;
    provider: PlaylistRouteProvider | null;
    playlistId: string | null;
    section: string | null;
}

const LAST_SECTION_STORAGE_KEY = 'playlist-switcher:last-sections';
const LAST_ACTIVE_PLAYLIST_STORAGE_KEY =
    'playlist-switcher:last-active-playlist-id';
const SEARCH_QUERY_STORAGE_KEY = 'playlist-switcher:search-query';
const PLAYLIST_TYPE_FILTER_STORAGE_KEY = 'playlist-switcher:type-filters';
const DEFAULT_PLAYLIST_TYPE_FILTERS: Record<PlaylistFilterType, boolean> = {
    m3u: true,
    stalker: true,
    xtream: true,
};
interface PlaylistSectionMemory {
    providers: Partial<Record<PlaylistSectionProvider, string>>;
    playlists: Record<
        string,
        {
            provider: PlaylistSectionProvider;
            section: string;
            updatedAt: number;
        }
    >;
}
const XTREAM_SECTIONS = [
    'live',
    'vod',
    'series',
    'favorites',
    'recent',
    'search',
    'recently-added',
    'downloads',
] as const;
const STALKER_SECTIONS = [
    'itv',
    'vod',
    'series',
    'favorites',
    'recent',
    'search',
    'downloads',
] as const;

@Component({
    selector: 'app-playlist-switcher',
    templateUrl: './playlist-switcher.component.html',
    styleUrls: ['./playlist-switcher.component.scss'],
    imports: [
        DatePipe,
        FormsModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatMenuModule,
        MatRippleModule,
        TranslatePipe,
    ],
})
export class PlaylistSwitcherComponent {
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly portalStatusService = inject(PortalStatusService);
    private focusSearchTimeoutId: ReturnType<typeof setTimeout> | null = null;

    /** Current playlist title to display */
    readonly currentTitle = input.required<string>();
    /** Subtitle to display (e.g., "123 Channels" or "Xtream Code") */
    readonly subtitle = input<string>('');
    /** Emitted when a different playlist is selected */
    readonly playlistSelected = output<string>();

    readonly menuTrigger = viewChild.required<MatMenuTrigger>('menuTrigger');
    readonly playlistMenu = viewChild.required<MatMenu>('playlistMenu');
    readonly triggerElement =
        viewChild.required<ElementRef<HTMLElement>>('triggerElement');
    readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');

    /** Signal for tracking menu open state */
    readonly isMenuOpen = signal(false);

    /** Search query for filtering playlists */
    readonly searchQuery = signal(this.readPersistedSearchQuery());
    readonly playlistTypeFilters = signal(this.readPersistedTypeFilters());

    /** All playlists from store */
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);
    readonly allPlaylistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );

    /** Filtered playlists based on search query, sorted by importDate (newest first) */
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
                  (p) =>
                      p.title?.toLowerCase().includes(query) ||
                      p.filename?.toLowerCase().includes(query)
              )
            : filteredByType;

        return [...filtered].sort(
            (a, b) =>
                new Date(b.importDate ?? 0).getTime() -
                new Date(a.importDate ?? 0).getTime()
        );
    });

    /** Current active playlist ID from route */
    readonly routePlaylistId = signal<string | null>(null);
    readonly selectedPlaylistId = this.store.selectSignal(
        selectActivePlaylistId
    );
    readonly activePlaylistId = computed(() => {
        return this.routePlaylistId() ?? this.selectedPlaylistId() ?? null;
    });
    readonly activePlaylist = computed(() => {
        const playlistId = this.activePlaylistId();
        if (!playlistId) {
            return null;
        }

        return (
            this.playlists().find((playlist) => playlist._id === playlistId) ??
            null
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

    /** Portal statuses for Xtream playlists */
    readonly portalStatuses = signal<Map<string, PortalStatus>>(new Map());

    constructor() {
        // Extract playlist ID from current route
        this.updateActivePlaylistFromRoute(this.router.url);
        this.rememberSectionFromRoute(this.router.url);
        effect(() => {
            if (!this.allPlaylistsLoaded()) {
                return;
            }
            const playlistIds = this.playlists().map(
                (playlist) => playlist._id
            );
            this.removeDeletedPlaylistsFromSectionMemory(playlistIds);
        });
        effect(() => {
            const allPlaylistsLoaded = this.allPlaylistsLoaded();
            const playlistIds = this.playlists().map(
                (playlist) => playlist._id
            );
            const playlistIdSet = new Set(playlistIds);
            const selectedId = this.selectedPlaylistId();
            const routeId = this.routePlaylistId();
            const storedId = this.readPersistedActivePlaylistId();

            // Before playlists are loaded, avoid stale cleanups.
            // But still keep storage in sync with explicit runtime context.
            if (!allPlaylistsLoaded) {
                if (routeId) {
                    this.writePersistedActivePlaylistId(routeId);
                    return;
                }
                if (selectedId) {
                    this.writePersistedActivePlaylistId(selectedId);
                }
                return;
            }

            // If route provides playlist context, keep storage in sync with URL state.
            if (routeId && playlistIdSet.has(routeId)) {
                this.writePersistedActivePlaylistId(routeId);
                return;
            }

            // Keep storage up-to-date with selected playlist state.
            if (selectedId && playlistIdSet.has(selectedId)) {
                this.writePersistedActivePlaylistId(selectedId);
                return;
            }

            // On routes without playlist in URL (for example dashboard),
            // restore last known active playlist when store has none.
            if (
                !routeId &&
                !selectedId &&
                storedId &&
                playlistIdSet.has(storedId)
            ) {
                this.store.dispatch(
                    PlaylistActions.setActivePlaylist({ playlistId: storedId })
                );
                return;
            }

            // Remove stale value if playlist no longer exists.
            if (storedId && !playlistIdSet.has(storedId)) {
                this.clearPersistedActivePlaylistId();
            }
        });

        // Listen for route changes
        this.router.events
            .pipe(
                filter((event) => event instanceof NavigationEnd),
                takeUntilDestroyed()
            )
            .subscribe((event: NavigationEnd) => {
                this.updateActivePlaylistFromRoute(event.urlAfterRedirects);
                this.rememberSectionFromRoute(event.urlAfterRedirects);
            });

        this.destroyRef.onDestroy(() => {
            this.clearMenuOverlayWidth();
            this.clearSearchFocusTimeout();
        });
    }

    private updateActivePlaylistFromRoute(url: string) {
        // Match routes like /playlists/:id, /xtreams/:id, /stalker/:id
        const match = url.match(/\/(playlists|xtreams|stalker)\/([^/?]+)/);
        if (match) {
            this.routePlaylistId.set(match[2]);
        } else {
            this.routePlaylistId.set(null);
        }
    }

    private rememberSectionFromRoute(url: string): void {
        const routeContext = this.getRouteContext(url);
        if (
            !routeContext.provider ||
            routeContext.provider === 'playlists' ||
            !routeContext.section
        ) {
            return;
        }

        const normalized = this.normalizeSectionForProvider(
            routeContext.section,
            routeContext.provider
        );
        if (!normalized) {
            return;
        }

        const memory = this.readSectionMemory();
        memory.providers[routeContext.provider] = normalized;
        if (routeContext.playlistId) {
            memory.playlists[routeContext.playlistId] = {
                provider: routeContext.provider,
                section: normalized,
                updatedAt: Date.now(),
            };
        }
        this.writeSectionMemory(memory);
    }

    private async checkPortalStatuses(playlists: PlaylistMeta[]) {
        const statusPromises = playlists
            .filter(
                (playlist) =>
                    playlist.serverUrl && playlist.username && playlist.password
            )
            .map(async (playlist) => {
                try {
                    const status =
                        await this.portalStatusService.checkPortalStatus(
                            playlist.serverUrl,
                            playlist.username,
                            playlist.password
                        );
                    return { id: playlist._id, status };
                } catch {
                    return {
                        id: playlist._id,
                        status: 'unavailable' as PortalStatus,
                    };
                }
            });

        const results = await Promise.all(statusPromises);
        const statusMap = new Map(results.map((r) => [r.id, r.status]));
        this.portalStatuses.set(statusMap);
    }

    onMenuOpened() {
        this.isMenuOpen.set(true);
        this.syncMenuOverlayWidthToTrigger();
        this.focusSearchField();
        this.checkPortalStatuses(this.playlists());
    }

    onMenuClosed() {
        this.isMenuOpen.set(false);
        this.clearMenuOverlayWidth();
        this.clearSearchFocusTimeout();
    }

    setSearchQuery(value: string) {
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

    private syncMenuOverlayWidthToTrigger() {
        const triggerWidth = Math.round(
            this.triggerElement().nativeElement.getBoundingClientRect().width
        );
        this.document.documentElement.style.setProperty(
            '--playlist-switcher-overlay-width',
            `${triggerWidth}px`
        );
    }

    private clearMenuOverlayWidth() {
        this.document.documentElement.style.removeProperty(
            '--playlist-switcher-overlay-width'
        );
    }

    private focusSearchField() {
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

    private clearSearchFocusTimeout() {
        if (this.focusSearchTimeoutId !== null) {
            clearTimeout(this.focusSearchTimeoutId);
            this.focusSearchTimeoutId = null;
        }
    }

    selectPlaylist(playlist: PlaylistMeta) {
        const routeContext = this.getRouteContext(this.router.url);
        const provider = this.getProviderForPlaylist(playlist);

        this.setActivePlaylist(playlist._id);

        const targetCommands = this.getTargetCommands(
            provider,
            playlist._id,
            routeContext
        );
        if (targetCommands) {
            this.router.navigate(targetCommands);
        }

        this.playlistSelected.emit(playlist._id);
    }

    private setActivePlaylist(playlistId: string): void {
        this.store.dispatch(PlaylistActions.setActivePlaylist({ playlistId }));
    }

    private isWorkspaceRoute(url: string): boolean {
        return /^\/workspace(?:\/|$)/.test(url);
    }

    private getProviderForPlaylist(
        playlist: PlaylistMeta
    ): PlaylistRouteProvider {
        if (playlist.serverUrl) {
            return 'xtreams';
        }
        if (playlist.macAddress) {
            return 'stalker';
        }
        return 'playlists';
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

    private getRouteContext(url: string): PlaylistRouteContext {
        const inWorkspace = this.isWorkspaceRoute(url);
        const isWorkspaceDashboard =
            /^\/workspace(?:\/dashboard)?(?:\/)?(?:\?.*)?$/.test(url);
        const match = url.match(
            /^\/(?:workspace\/)?(playlists|xtreams|stalker)\/([^/?]+)(?:\/([^/?]+))?/
        );

        return {
            inWorkspace,
            isWorkspaceDashboard,
            provider: (match?.[1] as PlaylistRouteProvider | undefined) ?? null,
            playlistId: match?.[2] ?? null,
            section: match?.[3] ?? null,
        };
    }

    private getTargetCommands(
        provider: PlaylistRouteProvider,
        playlistId: string,
        routeContext: PlaylistRouteContext
    ): string[] | null {
        const prefix = routeContext.inWorkspace ? ['workspace'] : [];

        // In workspace routes without explicit provider context (for example
        // dashboard and sources), selecting a source should only change active
        // context and must not trigger navigation.
        if (routeContext.inWorkspace && !routeContext.provider) {
            return null;
        }

        if (provider === 'playlists') {
            return [...prefix, 'playlists', playlistId];
        }

        if (!this.supportsSectionNavigation(provider)) {
            return [...prefix, provider, playlistId];
        }

        const section = this.resolveTargetSection(
            provider,
            routeContext.section,
            playlistId
        );
        return [...prefix, provider, playlistId, section];
    }

    private resolveTargetSection(
        provider: PlaylistSectionProvider,
        currentSection: string | null,
        targetPlaylistId: string
    ): string {
        const fromCurrent = this.normalizeSectionForProvider(
            currentSection,
            provider
        );
        if (fromCurrent) {
            return fromCurrent;
        }

        const memory = this.readSectionMemory();
        const playlistMemory = memory.playlists[targetPlaylistId];
        if (playlistMemory?.provider === provider) {
            const normalizedPlaylistSection = this.normalizeSectionForProvider(
                playlistMemory.section,
                provider
            );
            if (normalizedPlaylistSection) {
                return normalizedPlaylistSection;
            }
        }

        const providerMemory = memory.providers[provider];
        const normalizedProviderSection = this.normalizeSectionForProvider(
            providerMemory,
            provider
        );
        if (normalizedProviderSection) {
            return normalizedProviderSection;
        }

        return 'vod';
    }

    private supportsSectionNavigation(
        provider: PlaylistSectionProvider
    ): boolean {
        if (provider === 'xtreams') {
            return Boolean(window.electron);
        }
        return true;
    }

    private normalizeSectionForProvider(
        section: string | null | undefined,
        provider: PlaylistSectionProvider
    ): string | null {
        if (!section) {
            return null;
        }

        if (provider === 'xtreams') {
            if (section === 'itv') {
                return 'live';
            }
            return XTREAM_SECTIONS.includes(
                section as (typeof XTREAM_SECTIONS)[number]
            )
                ? section
                : null;
        }

        if (section === 'live') {
            return 'itv';
        }
        if (section === 'recently-added') {
            return 'recent';
        }
        return STALKER_SECTIONS.includes(
            section as (typeof STALKER_SECTIONS)[number]
        )
            ? section
            : null;
    }

    private readSectionMemory(): PlaylistSectionMemory {
        const empty: PlaylistSectionMemory = { providers: {}, playlists: {} };

        try {
            const raw = localStorage.getItem(LAST_SECTION_STORAGE_KEY);
            if (!raw) {
                return empty;
            }
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null) {
                return empty;
            }

            const providers: Partial<Record<PlaylistSectionProvider, string>> =
                {};
            const playlists: PlaylistSectionMemory['playlists'] = {};

            const parsedProviders = (parsed as Record<string, unknown>)[
                'providers'
            ];
            if (
                typeof parsedProviders === 'object' &&
                parsedProviders !== null
            ) {
                const candidate = parsedProviders as Record<string, unknown>;
                if (typeof candidate['xtreams'] === 'string') {
                    providers.xtreams = candidate['xtreams'];
                }
                if (typeof candidate['stalker'] === 'string') {
                    providers.stalker = candidate['stalker'];
                }
            } else {
                // Backward compatibility with previous format:
                // { xtreams: "...", stalker: "..." }
                const legacy = parsed as Record<string, unknown>;
                if (typeof legacy['xtreams'] === 'string') {
                    providers.xtreams = legacy['xtreams'];
                }
                if (typeof legacy['stalker'] === 'string') {
                    providers.stalker = legacy['stalker'];
                }
            }

            const parsedPlaylists = (parsed as Record<string, unknown>)[
                'playlists'
            ];
            if (
                typeof parsedPlaylists === 'object' &&
                parsedPlaylists !== null
            ) {
                Object.entries(
                    parsedPlaylists as Record<string, unknown>
                ).forEach(([playlistId, value]) => {
                    if (!value || typeof value !== 'object' || !playlistId) {
                        return;
                    }

                    const row = value as Record<string, unknown>;
                    const provider = row['provider'];
                    const section = row['section'];
                    const updatedAt = row['updatedAt'];
                    const isProviderValid =
                        provider === 'xtreams' || provider === 'stalker';
                    if (!isProviderValid || typeof section !== 'string') {
                        return;
                    }

                    playlists[playlistId] = {
                        provider,
                        section,
                        updatedAt:
                            typeof updatedAt === 'number'
                                ? updatedAt
                                : Date.now(),
                    };
                });
            }

            return { providers, playlists };
        } catch {
            return empty;
        }
    }

    private writeSectionMemory(memory: PlaylistSectionMemory): void {
        try {
            localStorage.setItem(
                LAST_SECTION_STORAGE_KEY,
                JSON.stringify(memory)
            );
        } catch {
            // Ignore storage write failures (private mode/storage quota).
        }
    }

    private readPersistedActivePlaylistId(): string | null {
        try {
            const value = localStorage.getItem(
                LAST_ACTIVE_PLAYLIST_STORAGE_KEY
            );
            return value && value.trim().length > 0 ? value : null;
        } catch {
            return null;
        }
    }

    private writePersistedActivePlaylistId(playlistId: string): void {
        try {
            localStorage.setItem(LAST_ACTIVE_PLAYLIST_STORAGE_KEY, playlistId);
        } catch {
            // Ignore storage write failures (private mode/storage quota).
        }
    }

    private clearPersistedActivePlaylistId(): void {
        try {
            localStorage.removeItem(LAST_ACTIVE_PLAYLIST_STORAGE_KEY);
        } catch {
            // Ignore storage write failures.
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
            // Ignore storage write failures (private mode/storage quota).
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
            // Ignore storage write failures (private mode/storage quota).
        }
    }

    private removeDeletedPlaylistsFromSectionMemory(
        existingIds: string[]
    ): void {
        const existingIdSet = new Set(existingIds);
        const memory = this.readSectionMemory();
        const currentEntries = Object.entries(memory.playlists);
        if (currentEntries.length === 0) {
            return;
        }

        const nextPlaylists: PlaylistSectionMemory['playlists'] = {};
        let hasChanges = false;

        currentEntries.forEach(([playlistId, entry]) => {
            if (!existingIdSet.has(playlistId)) {
                hasChanges = true;
                return;
            }

            const normalizedSection = this.normalizeSectionForProvider(
                entry.section,
                entry.provider
            );
            if (!normalizedSection) {
                hasChanges = true;
                return;
            }

            nextPlaylists[playlistId] = {
                ...entry,
                section: normalizedSection,
            };
        });

        if (!hasChanges) {
            return;
        }

        this.writeSectionMemory({
            providers: memory.providers,
            playlists: nextPlaylists,
        });
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

    getStatusClass(playlistId: string): string {
        const status = this.portalStatuses().get(playlistId);
        return this.portalStatusService.getStatusClass(status || 'unavailable');
    }

    isSelected(playlist: PlaylistMeta): boolean {
        return this.activePlaylistId() === playlist._id;
    }
}
