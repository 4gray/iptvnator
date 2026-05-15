import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    EmptyStateComponent,
    PlaylistInfoComponent,
} from '@iptvnator/playlist/shared/ui';
import { PlaylistRefreshActionService } from '@iptvnator/playlist/shared/util';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspacePlaylistType,
} from '@iptvnator/workspace/shell/util';
import { DialogService } from '@iptvnator/ui/components';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DatabaseService } from '@iptvnator/services';
import {
    DashboardDataService,
    DashboardFavoriteItem,
    DashboardRecentlyAddedItem,
    GlobalRecentItem,
} from '@iptvnator/workspace/dashboard/data-access';
import { DashboardRailComponent } from './dashboard-rail.component';
import type {
    DashboardRailAction,
    DashboardRailCard,
    DashboardRailActionSelection,
} from './dashboard-rail.component';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';

// Cap dashboard rails at 20 items. Users get ~3× what's visible at once,
// the DOM stays cheap, and the "Manage all" link is one click away for the
// full list. Matches the single-rail density of Netflix / Apple TV+.
const RAIL_ITEM_LIMIT = 20;

// Six placeholder slots per skeleton rail — fills a typical viewport without
// taking the whole page. Mirrors the recently-added skeleton density.
const SKELETON_CARDS_PER_RAIL = [1, 2, 3, 4, 5, 6] as const;
const SKELETON_RAILS = [1, 2, 3] as const;

interface DashboardHeroModel {
    readonly backdropUrl?: string;
    readonly backdropSource: DashboardHeroBackdropSource;
    readonly contentType?: 'live' | 'movie' | 'series';
    readonly fallbackBackdropBackground: string;
    readonly fallbackPosterBackground: string;
    readonly hasBackdrop: boolean;
    readonly icon: string;
    readonly link: string[];
    readonly posterUrl?: string;
    readonly state?: Record<string, unknown>;
    readonly subtitle: string;
    readonly title: string;
}

export type DashboardHeroBackdropSource = 'backdrop' | 'poster' | 'fallback';

export interface DashboardHeroArtworkInput {
    readonly backdropUrl?: string | null;
    readonly posterUrl?: string | null;
    readonly title: string;
}

export interface DashboardHeroArtwork {
    readonly backdropUrl?: string;
    readonly backdropSource: DashboardHeroBackdropSource;
    readonly fallbackBackdropBackground: string;
    readonly fallbackPosterBackground: string;
    readonly hasBackdrop: boolean;
    readonly posterUrl?: string;
}

export function resolveDashboardHeroArtwork(
    item: DashboardHeroArtworkInput,
    failedImages: Record<string, true>
): DashboardHeroArtwork {
    const posterUrl =
        item.posterUrl && !failedImages[item.posterUrl]
            ? item.posterUrl
            : undefined;
    const explicitBackdropUrl =
        item.backdropUrl && !failedImages[item.backdropUrl]
            ? item.backdropUrl
            : undefined;
    const backdropUrl = explicitBackdropUrl ?? posterUrl;
    const backdropSource: DashboardHeroBackdropSource = explicitBackdropUrl
        ? 'backdrop'
        : posterUrl
          ? 'poster'
          : 'fallback';

    return {
        backdropUrl,
        backdropSource,
        fallbackBackdropBackground: buildFallbackBackground(
            item.title,
            50,
            15,
            80,
            5,
            60
        ),
        fallbackPosterBackground: buildFallbackBackground(
            item.title,
            40,
            25,
            50,
            15,
            40
        ),
        hasBackdrop: backdropSource === 'backdrop',
        posterUrl,
    };
}

function buildFallbackBackground(
    title: string,
    saturationA: number,
    lightnessA: number,
    saturationB: number,
    lightnessB: number,
    hueOffset: number
): string {
    const hue = calculateHue(title || 'placeholder');
    const h2 = (hue + hueOffset) % 360;
    return `linear-gradient(135deg, hsl(${hue}, ${saturationA}%, ${lightnessA}%) 0%, hsl(${h2}, ${saturationB}%, ${lightnessB}%) 100%)`;
}

function calculateHue(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = text.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    return Math.abs(hash) % 360;
}

export type DashboardSourceActionId =
    | 'refresh'
    | 'playlist-info'
    | 'account-info'
    | 'remove';

export function buildDashboardSourceActions(
    playlist: PlaylistMeta,
    canRefresh: boolean
): DashboardRailAction[] {
    const actions: DashboardRailAction[] = [];

    if (canRefresh) {
        actions.push({
            id: 'refresh',
            icon: 'sync',
            labelKey: playlist.serverUrl
                ? 'HOME.PLAYLISTS.REFRESH_XTREAM'
                : 'HOME.PLAYLISTS.REFRESH',
        });
    }

    actions.push({
        id: 'playlist-info',
        icon: 'edit',
        labelKey: 'HOME.PLAYLISTS.SHOW_DETAILS',
    });

    if (isXtreamAccountPlaylist(playlist)) {
        actions.push({
            id: 'account-info',
            icon: 'person',
            labelKey: 'WORKSPACE.SHELL.ACCOUNT_INFO',
        });
    }

    actions.push({
        id: 'remove',
        icon: 'delete',
        labelKey: 'HOME.PLAYLISTS.REMOVE_DIALOG.TITLE',
        destructive: true,
        separatorBefore: true,
    });

    return actions;
}

function isXtreamAccountPlaylist(
    playlist: PlaylistMeta
): playlist is PlaylistMeta & {
    serverUrl: string;
    username: string;
    password: string;
} {
    return Boolean(
        playlist.serverUrl && playlist.username && playlist.password
    );
}

@Component({
    selector: 'lib-workspace-dashboard-rails',
    imports: [
        DashboardRailComponent,
        EmptyStateComponent,
        MatButtonModule,
        MatIcon,
        RouterLink,
        TranslatePipe,
    ],
    templateUrl: './workspace-dashboard-rails.component.html',
    styleUrl: './workspace-dashboard-rails.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.rails-page-host--empty]': 'ready() && !hasPlaylists()',
    },
})
export class WorkspaceDashboardRailsComponent {
    readonly data = inject(DashboardDataService);
    private readonly databaseService = inject(DatabaseService);
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly shellActions = inject(WORKSPACE_SHELL_ACTIONS);

    readonly hasPlaylists = computed(() => this.data.playlists().length > 0);
    readonly ready = this.data.dashboardReady;
    readonly xtreamPlaylistCount = this.data.xtreamPlaylistCount;
    readonly isElectron = !!window.electron;

    readonly skeletonSlots = SKELETON_CARDS_PER_RAIL;
    readonly skeletonRails = SKELETON_RAILS;
    readonly failedHeroImages = signal<Record<string, true>>({});

    readonly hero = computed<DashboardHeroModel | null>(() => {
        const item = this.data.globalRecentItems()[0] ?? null;
        if (!item) {
            return null;
        }

        const artwork = resolveDashboardHeroArtwork(
            {
                backdropUrl: item.backdrop_url,
                posterUrl: item.poster_url,
                title: item.title,
            },
            this.failedHeroImages()
        );

        return {
            ...artwork,
            contentType: item.type,
            icon: this.typeIcon(item.type),
            link: this.data.getRecentItemLink(item),
            state: this.data.getRecentItemNavigationState(item),
            subtitle: this.buildHeroSubtitle(item),
            title: item.title,
        };
    });

    readonly recentlyWatchedCards = computed<DashboardRailCard[]>(() =>
        this.data
            .globalRecentItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toRecentCard(item))
    );

    readonly favoriteCards = computed<DashboardRailCard[]>(() =>
        this.data
            .globalFavoriteItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toFavoriteCard(item))
    );

    readonly xtreamRecentlyAddedCards = computed<DashboardRailCard[]>(() =>
        this.data
            .xtreamRecentlyAddedItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toRecentlyAddedCard(item))
    );

    readonly sourceCards = computed<DashboardRailCard[]>(() =>
        this.data.recentPlaylists().map((playlist) => ({
            id: playlist._id,
            title:
                playlist.title ||
                playlist.filename ||
                this.t('WORKSPACE.DASHBOARD.UNTITLED_SOURCE'),
            subtitle: this.data.getPlaylistProvider(playlist),
            icon: playlist.serverUrl
                ? 'cloud'
                : playlist.macAddress
                  ? 'cast'
                  : 'folder_open',
            link: this.data.getPlaylistLink(playlist),
            actions: buildDashboardSourceActions(
                playlist,
                this.playlistRefreshAction.canRefresh(playlist)
            ),
        }))
    );

    constructor() {
        // Re-entering the dashboard should pick up any DB-backed recent/favorite
        // changes made while viewing details, including newly backfilled
        // backdrops that do not change recency ordering.
        void this.data.reloadGlobalRecentItems();
        void this.data.reloadGlobalFavorites();

        // Refresh when Xtream playlist count changes so a newly added provider
        // populates the rail without a manual dashboard reload.
        effect(() => {
            if (this.xtreamPlaylistCount() === 0) {
                return;
            }

            void this.data.reloadXtreamRecentlyAddedItems(RAIL_ITEM_LIMIT);
        });
    }

    onAddPlaylist(type?: WorkspacePlaylistType): void {
        this.shellActions.openAddPlaylistDialog(type);
    }

    markHeroImageFailed(url: string): void {
        this.failedHeroImages.update((state) =>
            state[url] ? state : { ...state, [url]: true }
        );
    }

    onSourceActionSelected(selection: DashboardRailActionSelection): void {
        const playlist = this.data
            .playlists()
            .find((item) => item._id === selection.card.id);

        if (!playlist) {
            return;
        }

        switch (selection.action.id as DashboardSourceActionId) {
            case 'refresh':
                this.playlistRefreshAction.refresh(playlist);
                break;
            case 'playlist-info':
                this.dialog.open(PlaylistInfoComponent, { data: playlist });
                break;
            case 'account-info':
                this.openXtreamAccountInfo(playlist);
                break;
            case 'remove':
                this.confirmRemovePlaylist(playlist);
                break;
        }
    }

    private buildHeroSubtitle(item: GlobalRecentItem): string {
        const parts = [
            item.playlist_name,
            this.data.getRecentItemProviderLabel(item),
            this.data.getRecentItemTypeLabel(item),
        ].filter((value): value is string => Boolean(value));
        return parts.join(' · ');
    }

    private toRecentCard(item: GlobalRecentItem): DashboardRailCard {
        return {
            id: `recent-${item.id}-${item.playlist_id}-${item.viewed_at}`,
            title: item.title,
            subtitle: `${this.data.getRecentItemProviderLabel(item)} · ${this.data.getRecentItemTypeLabel(item)}`,
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            link: this.data.getRecentItemLink(item),
            state: this.data.getRecentItemNavigationState(item),
        };
    }

    private toFavoriteCard(item: DashboardFavoriteItem): DashboardRailCard {
        return {
            id: `fav-${item.id}-${item.playlist_id}-${item.added_at}`,
            title: item.title,
            subtitle: `${this.data.getFavoriteItemProviderLabel(item)} · ${this.data.getFavoriteItemTypeLabel(item)}`,
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            link: this.data.getGlobalFavoriteLink(item),
            state: this.data.getGlobalFavoriteNavigationState(item),
        };
    }

    private toRecentlyAddedCard(
        item: DashboardRecentlyAddedItem
    ): DashboardRailCard {
        const typeLabel = this.data.getRecentlyAddedItemTypeLabel(item);
        const subtitleParts = [item.playlist_name, typeLabel].filter(
            (value): value is string => Boolean(value)
        );
        return {
            id: `added-${item.id}-${item.playlist_id}-${item.added_at}`,
            title: item.title,
            subtitle: subtitleParts.join(' · '),
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            link: this.data.getRecentlyAddedLink(item),
            state: this.data.getRecentlyAddedNavigationState(item),
        };
    }

    private typeIcon(type: 'live' | 'movie' | 'series'): string {
        if (type === 'live') return 'live_tv';
        if (type === 'movie') return 'movie';
        return 'video_library';
    }

    private openXtreamAccountInfo(playlist: PlaylistMeta): void {
        if (!isXtreamAccountPlaylist(playlist)) {
            return;
        }

        const title =
            playlist.title ||
            playlist.filename ||
            this.t('WORKSPACE.DASHBOARD.UNTITLED_SOURCE');

        this.shellActions.openAccountInfo({
            playlist: {
                id: playlist._id,
                name: title,
                title,
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
            },
        });
    }

    private confirmRemovePlaylist(playlist: PlaylistMeta): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            onConfirm: () => {
                void this.removePlaylist(playlist);
            },
        });
    }

    private async removePlaylist(playlist: PlaylistMeta): Promise<void> {
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

    private t(key: string): string {
        return this.translate.instant(key);
    }
}
