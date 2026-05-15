import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
    PlaylistActions,
    selectActivePlaylistId,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { filter } from 'rxjs';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    PortalProvider,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';

export interface PlaylistRouteContext {
    inWorkspace: boolean;
    provider: PortalProvider | null;
    playlistId: string | null;
    section: PortalRailSection | null;
}

type PlaylistSectionMemory = {
    providers: Partial<Record<PortalProvider, string>>;
    playlists: Record<
        string,
        {
            provider: PortalProvider;
            section: string;
            updatedAt: number;
        }
    >;
};

const LAST_SECTION_STORAGE_KEY = 'playlist-switcher:last-sections:v2';
const LEGACY_LAST_SECTION_STORAGE_KEY = 'playlist-switcher:last-sections';
const LAST_ACTIVE_PLAYLIST_STORAGE_KEY =
    'playlist-switcher:last-active-playlist-id';
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
const M3U_SECTIONS = ['all', 'groups', 'favorites', 'recent'] as const;

@Injectable({ providedIn: 'root' })
export class PlaylistContextFacade {
    private readonly destroyRef = inject(DestroyRef);
    private readonly router = inject(Router);
    private readonly store = inject(Store);

    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);
    readonly allPlaylistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly activePlaylistId = this.store.selectSignal(selectActivePlaylistId);

    readonly currentUrl = signal(this.router.url);
    readonly routeContext = computed(() =>
        this.getRouteContext(this.currentUrl())
    );
    readonly routeProvider = computed(() => this.routeContext().provider);
    readonly routePlaylistId = computed(() => this.routeContext().playlistId);
    readonly routeSection = computed(() => this.routeContext().section);
    readonly resolvedPlaylistId = computed(() => {
        const routePlaylistId = this.routePlaylistId();
        if (routePlaylistId) {
            return routePlaylistId;
        }

        const activePlaylistId = this.activePlaylistId();
        return activePlaylistId || null;
    });
    readonly activePlaylist = computed(() => {
        const playlistId = this.resolvedPlaylistId();
        if (!playlistId) {
            return null;
        }

        return (
            this.playlists().find((playlist) => playlist._id === playlistId) ??
            null
        );
    });
    readonly activeProvider = computed(() => {
        const playlist = this.activePlaylist();
        return playlist ? this.getProviderForPlaylist(playlist) : null;
    });

    constructor() {
        this.clearLegacySectionMemory();
        this.syncFromUrl(this.router.url);

        effect(() => {
            const allPlaylistsLoaded = this.allPlaylistsLoaded();
            const playlistIds = this.playlists().map(
                (playlist) => playlist._id
            );
            const playlistIdSet = new Set(playlistIds);
            const selectedId = this.activePlaylistId() || null;
            const routeId = this.routePlaylistId();
            const storedId = this.readPersistedActivePlaylistId();

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

            this.removeDeletedPlaylistsFromSectionMemory(playlistIds);

            if (routeId && playlistIdSet.has(routeId)) {
                this.writePersistedActivePlaylistId(routeId);
                return;
            }

            if (selectedId && playlistIdSet.has(selectedId)) {
                this.writePersistedActivePlaylistId(selectedId);
                return;
            }

            if (
                !routeId &&
                !selectedId &&
                storedId &&
                playlistIdSet.has(storedId)
            ) {
                this.activatePlaylist(storedId);
                return;
            }

            if (storedId && !playlistIdSet.has(storedId)) {
                this.clearPersistedActivePlaylistId();
            }
        });

        this.router.events
            .pipe(
                filter(
                    (event): event is NavigationEnd =>
                        event instanceof NavigationEnd
                ),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe((event) => {
                this.syncFromUrl(event.urlAfterRedirects);
            });
    }

    syncFromUrl(url = this.router.url): PlaylistRouteContext {
        this.currentUrl.set(url);
        const routeContext = this.routeContext();

        this.rememberSection(routeContext);

        if (routeContext.playlistId) {
            this.activatePlaylist(routeContext.playlistId);
        }

        return routeContext;
    }

    activatePlaylist(playlistId: string): void {
        if (!playlistId || this.activePlaylistId() === playlistId) {
            return;
        }

        this.store.dispatch(PlaylistActions.setActivePlaylist({ playlistId }));
    }

    selectPlaylist(playlist: PlaylistMeta): void {
        const routeContext = this.routeContext();
        const provider = this.getProviderForPlaylist(playlist);

        this.activatePlaylist(playlist._id);

        const targetCommands = this.resolveTargetCommands(
            provider,
            playlist._id,
            routeContext
        );

        if (targetCommands) {
            void this.router.navigate(targetCommands);
        }
    }

    resolveTargetCommands(
        provider: PortalProvider,
        playlistId: string,
        routeContext = this.routeContext()
    ): string[] | null {
        const prefix = routeContext.inWorkspace ? ['workspace'] : [];

        if (routeContext.inWorkspace && !routeContext.provider) {
            return null;
        }

        if (provider === 'playlists') {
            const section = this.resolveTargetSection(
                provider,
                routeContext.section,
                playlistId
            );
            return [...prefix, 'playlists', playlistId, section];
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

    getProviderForPlaylist(playlist: PlaylistMeta): PortalProvider {
        if (playlist.serverUrl) {
            return 'xtreams';
        }
        if (playlist.macAddress) {
            return 'stalker';
        }
        return 'playlists';
    }

    private isWorkspaceRoute(url: string): boolean {
        return /^\/workspace(?:\/|$)/.test(url);
    }

    private getRouteContext(url: string): PlaylistRouteContext {
        const match = url.match(
            /^\/(?:workspace\/)?(playlists|xtreams|stalker)\/([^/?]+)(?:\/([^/?]+))?/
        );

        return {
            inWorkspace: this.isWorkspaceRoute(url),
            provider: (match?.[1] as PortalProvider | undefined) ?? null,
            playlistId: match?.[2] ?? null,
            section: (match?.[3] as PortalRailSection | undefined) ?? null,
        };
    }

    private rememberSection(routeContext: PlaylistRouteContext): void {
        if (!routeContext.provider || !routeContext.section) {
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

    private resolveTargetSection(
        provider: PortalProvider,
        currentSection: PortalRailSection | null,
        targetPlaylistId: string
    ): string {
        const fromCurrent = this.normalizeSectionForProvider(
            currentSection,
            provider
        );
        if (fromCurrent) {
            return fromCurrent;
        }

        if (provider === 'playlists' && currentSection) {
            return 'all';
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

        if (provider === 'playlists') {
            return 'all';
        }

        return 'vod';
    }

    private supportsSectionNavigation(provider: PortalProvider): boolean {
        if (provider === 'xtreams') {
            return Boolean(window.electron);
        }

        return true;
    }

    private normalizeSectionForProvider(
        section: string | null | undefined,
        provider: PortalProvider
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

        if (provider === 'playlists') {
            return M3U_SECTIONS.includes(
                section as (typeof M3U_SECTIONS)[number]
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
            this.clearLegacySectionMemory();
            const raw = localStorage.getItem(LAST_SECTION_STORAGE_KEY);
            if (!raw) {
                return empty;
            }
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null) {
                return empty;
            }

            const providers: Partial<Record<PortalProvider, string>> = {};
            const playlists: PlaylistSectionMemory['playlists'] = {};

            const parsedProviders = (parsed as Record<string, unknown>)[
                'providers'
            ];
            if (typeof parsedProviders === 'object' && parsedProviders !== null) {
                const candidate = parsedProviders as Record<string, unknown>;
                if (typeof candidate['playlists'] === 'string') {
                    providers.playlists = candidate['playlists'];
                }
                if (typeof candidate['xtreams'] === 'string') {
                    providers.xtreams = candidate['xtreams'];
                }
                if (typeof candidate['stalker'] === 'string') {
                    providers.stalker = candidate['stalker'];
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
                        provider === 'playlists' ||
                        provider === 'xtreams' ||
                        provider === 'stalker';
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
            // Ignore storage write failures.
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
            // Ignore storage write failures.
        }
    }

    private clearPersistedActivePlaylistId(): void {
        try {
            localStorage.removeItem(LAST_ACTIVE_PLAYLIST_STORAGE_KEY);
        } catch {
            // Ignore storage write failures.
        }
    }

    private clearLegacySectionMemory(): void {
        try {
            if (!localStorage.getItem(LEGACY_LAST_SECTION_STORAGE_KEY)) {
                return;
            }

            localStorage.removeItem(LEGACY_LAST_SECTION_STORAGE_KEY);
        } catch {
            // Ignore storage read/write failures.
        }
    }
}
