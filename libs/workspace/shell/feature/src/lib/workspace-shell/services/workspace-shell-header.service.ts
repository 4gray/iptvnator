import { computed, inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    PlaylistInfoComponent,
    PlaylistRefreshActionService,
} from '@iptvnator/playlist/shared/ui';
import {
    LiveLayoutSidebarStateService,
    resolveRouteLiveSidebarSurface,
    WorkspaceHeaderAction,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    isStalkerAccountPlaylist,
    isXtreamAccountPlaylist,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import {
    WorkspaceAccountInfoData,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import { WorkspaceHeaderSidebarToggle } from './helpers/workspace-shell-constants';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';

@Injectable()
export class WorkspaceShellHeaderService {
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly workspaceActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly translate = inject(TranslateService);
    private readonly dialog = inject(MatDialog);
    private readonly routeState = inject(WorkspaceShellRouteStateService);
    private readonly headerContext = inject(WorkspaceHeaderContextService);
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private readonly liveSidebar = inject(LiveLayoutSidebarStateService);

    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly playlistTitle = computed(() => {
        const playlist = this.routeState.activePlaylist();

        return (
            playlist?.title ||
            playlist?.filename ||
            playlist?.url ||
            playlist?.portalUrl ||
            'Untitled playlist'
        );
    });
    readonly headerShortcut = computed<WorkspaceHeaderAction | null>(() => {
        const context = this.routeState.currentContext();
        const action = this.headerContext.action();

        if (!action || context?.provider !== 'playlists') {
            return null;
        }

        return action;
    });
    /**
     * The live rail of the current route, when the route renders one itself.
     * The header toggle needs a rail that exists in both states; collection
     * pages keep their own toggle beside the live/movies/series switch.
     */
    private readonly liveSidebarSurface = computed(() =>
        resolveRouteLiveSidebarSurface(
            this.routeState.currentContext()?.provider,
            this.routeState.currentSection()
        )
    );
    readonly headerSidebarToggle = computed<WorkspaceHeaderSidebarToggle | null>(
        () => {
            this.languageTick();

            const surface = this.liveSidebarSurface();
            if (!surface) {
                return null;
            }

            const collapsed = this.liveSidebar.isCollapsedFor(surface)();
            return {
                expanded: !collapsed,
                tooltip: this.translateText('LAYOUT.TOGGLE_SIDEBAR_TOOLTIP'),
                ariaLabel: this.translateText(
                    collapsed
                        ? 'LAYOUT.SHOW_CHANNELS_LIST'
                        : 'LAYOUT.HIDE_CHANNELS_LIST'
                ),
            };
        }
    );
    readonly canOpenPlaylistInfo = computed(() =>
        Boolean(this.routeState.activePlaylist())
    );
    readonly canOpenAccountInfo = computed(() => {
        const playlist = this.routeState.activePlaylist();
        return Boolean(
            playlist &&
                (isXtreamAccountPlaylist(playlist) ||
                    isStalkerAccountPlaylist(playlist))
        );
    });
    readonly canRefreshPlaylist = computed(() =>
        this.playlistRefreshAction.canRefresh(
            this.routeState.activePlaylist()
        )
    );
    readonly isRefreshingPlaylist = this.playlistRefreshAction.isRefreshing;
    readonly playlistSubtitle = computed(() => {
        this.languageTick();

        const active = this.routeState.activePlaylist();
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

        const sourcesCount = this.routeState.playlists().length;
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

    openAddPlaylistDialog(kind?: 'url' | 'stalker' | 'xtream'): void {
        if (kind) {
            this.workspaceActions.openAddPlaylistDialog(kind);
            return;
        }

        this.workspaceActions.openAddPlaylistDialog();
    }

    openGlobalSearch(initialQuery = ''): void {
        this.workspaceActions.openGlobalSearch(initialQuery);
    }

    openGlobalRecent(): void {
        this.workspaceActions.openGlobalRecent();
    }

    toggleLiveSidebar(): void {
        const surface = this.liveSidebarSurface();
        if (surface) {
            this.liveSidebar.toggle(surface);
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

    openPlaylistInfo(): void {
        const playlist = this.routeState.activePlaylist();
        if (!playlist) {
            return;
        }

        this.dialog.open(PlaylistInfoComponent, {
            data: playlist,
        });
    }

    openAccountInfo(): void {
        const playlist = this.routeState.activePlaylist();
        if (!playlist) {
            return;
        }

        this.openAccountInfoFor(playlist);
    }

    /**
     * Opens the matching account-info dialog for any portal playlist —
     * the active one (header button, command palette) or a specific row
     * (playlist switcher item menu).
     */
    openAccountInfoFor(playlist: PlaylistMeta): void {
        if (isXtreamAccountPlaylist(playlist)) {
            const isActivePlaylist =
                this.routeState.activePlaylist()?._id === playlist._id;
            const data: WorkspaceAccountInfoData = {
                // Stream counts describe the loaded portal session, so they
                // only apply when the dialog targets the active playlist.
                ...(isActivePlaylist
                    ? {
                          vodStreamsCount:
                              this.xtreamStore.vodStreams().length,
                          liveStreamsCount:
                              this.xtreamStore.liveStreams().length,
                          seriesCount: this.xtreamStore.serialStreams().length,
                      }
                    : {}),
                playlist: {
                    id: playlist._id,
                    name: playlist.title,
                    title: playlist.title,
                    serverUrl: playlist.serverUrl,
                    username: playlist.username,
                    password: playlist.password,
                },
            };
            this.workspaceActions.openAccountInfo(data);
            return;
        }

        if (isStalkerAccountPlaylist(playlist)) {
            this.workspaceActions.openStalkerAccountInfo({ playlist });
        }
    }

    refreshCurrentPlaylist(): void {
        const playlist = this.routeState.activePlaylist();

        if (!playlist || !this.canRefreshPlaylist()) {
            return;
        }

        this.playlistRefreshAction.refresh(playlist);
    }

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
