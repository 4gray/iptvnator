import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { interval, of, startWith, switchMap } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    type EpgProgram,
    normalizeDashboardRailsSettings,
} from '@iptvnator/shared/interfaces';
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
    PlaylistRefreshActionService,
} from '@iptvnator/playlist/shared/ui';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspacePlaylistType,
} from '@iptvnator/workspace/shell/util';
import { DialogService } from '@iptvnator/ui/components';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistDeleteActionService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    DashboardDataService,
    DashboardFavoriteItem,
    DashboardRecentlyAddedItem,
    GlobalRecentItem,
} from '@iptvnator/workspace/dashboard/data-access';
import { DashboardRailComponent } from './dashboard-rail.component';
import type {
    DashboardRailCard,
    DashboardRailActionSelection,
} from './dashboard-rail.component';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import type { DashboardHeroModel } from './dashboard-hero.utils';
import { resolveDashboardHeroArtwork } from './dashboard-hero.utils';
import {
    buildDashboardLiveEpgDetails,
    buildLiveEpgCardsForEnabledRails,
    buildLiveEpgLookupKeys,
    getLiveEpgProgramForCard,
    LIVE_EPG_TICK_MS,
} from './dashboard-live-epg.utils';
import type { DashboardLiveEpgDetails } from './dashboard-live-epg.utils';
import {
    buildPlaybackPositionReloadKey,
    formatRemainingLabel,
    isContinueWatchingRecentItem,
    playbackProgressPercent,
} from './dashboard-playback.utils';
import {
    buildDashboardCollectionViewState,
    buildDashboardRailSeeAllState,
    buildDashboardSourceActions,
    isXtreamAccountPlaylist,
    liveRailTitleKeyForSource,
    RAIL_ITEM_LIMIT,
    shouldShowLiveFavoritesSkeleton,
    shouldShowRecentContentSkeleton,
    SKELETON_CARDS_PER_RAIL,
    SKELETON_RAILS,
} from './dashboard-rail.utils';
import type { DashboardSourceActionId } from './dashboard-rail.utils';

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
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly playlistDeleteAction = inject(PlaylistDeleteActionService);
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    private readonly shellActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly epgService = inject(EpgService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);

    readonly hasPlaylists = computed(() => this.data.playlists().length > 0);
    readonly ready = this.data.dashboardReady;
    readonly xtreamPlaylistCount = this.data.xtreamPlaylistCount;
    readonly isElectron = this.runtime.isElectron;

    readonly skeletonSlots = SKELETON_CARDS_PER_RAIL;
    readonly skeletonRails = SKELETON_RAILS;
    readonly liveRailTitleKeyForSource = liveRailTitleKeyForSource;
    readonly failedHeroImages = signal<Record<string, true>>({});
    readonly dashboardRails = computed(() =>
        normalizeDashboardRailsSettings(this.settingsStore.dashboardRails?.())
    );

    private readonly heroRecentItem = computed(
        () => this.data.globalRecentItems()[0] ?? null
    );

    private readonly heroLiveCard = computed<DashboardRailCard | null>(() => {
        const item = this.heroRecentItem();
        return item?.type === 'live' ? this.toRecentCard(item) : null;
    });

    readonly hero = computed<DashboardHeroModel | null>(() => {
        const item = this.heroRecentItem();
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

        const position = this.data.getPlaybackPositionForItem(item);
        const liveEpgDetails =
            item.type === 'live'
                ? this.getLiveEpgDetailsForCard(this.heroLiveCard())
                : null;

        return {
            ...artwork,
            contentType: item.type,
            icon: this.typeIcon(item.type),
            link: this.data.getRecentItemLink(item),
            state: this.data.getRecentItemNavigationState(item),
            subtitle: this.buildHeroSubtitle(item),
            title: item.title,
            watchProgress: playbackProgressPercent(position),
            remainingLabel: formatRemainingLabel(position),
            nowPlayingTitle: liveEpgDetails?.nowPlayingTitle ?? null,
            nowPlayingTimeRange: liveEpgDetails?.nowPlayingTimeRange ?? null,
            nowPlayingProgress: liveEpgDetails?.nowPlayingProgress ?? null,
        };
    });

    readonly continueWatchingBaseCards = computed<DashboardRailCard[]>(() => {
        this.languageTick();
        return this.data
            .globalRecentVodItems()
            .filter(isContinueWatchingRecentItem)
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toRecentCard(item));
    });

    readonly continueWatchingCards = computed<DashboardRailCard[]>(() =>
        this.continueWatchingBaseCards()
    );

    readonly liveFavoriteCards = computed<DashboardRailCard[]>(() =>
        this.data
            .globalFavoriteLiveItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toFavoriteCard(item))
    );

    readonly recentLiveCards = computed<DashboardRailCard[]>(() =>
        this.data
            .globalRecentLiveItems()
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toRecentCard(item))
    );

    readonly showLiveFavoritesSkeleton = computed(() =>
        shouldShowLiveFavoritesSkeleton(this.dashboardRails(), {
            globalFavoritesLoading: this.data.globalFavoritesLoading(),
        })
    );

    readonly showRecentContentSkeleton = computed(() =>
        shouldShowRecentContentSkeleton(this.dashboardRails(), {
            continueWatchingCount: this.continueWatchingCards().length,
            globalRecentLoading: this.data.globalRecentLoading(),
            recentLiveCount: this.recentLiveCards().length,
        })
    );

    // Best-effort EPG lookup keyed by the app-wide M3U XMLTV chain
    // (tvg-id -> tvg-name -> name), with the card title as a final fallback.
    // Xtream/Stalker live items often have no XMLTV side-channel and will
    // simply return null — the card renders without the program row.
    private readonly liveChannelLookupKeys = computed(() => {
        const heroLiveCard = this.heroLiveCard();
        return buildLiveEpgLookupKeys(
            buildLiveEpgCardsForEnabledRails(
                this.dashboardRails(),
                heroLiveCard,
                this.liveFavoriteCards(),
                this.recentLiveCards()
            )
        );
    });

    private readonly playbackPositionReloadKey = computed(() =>
        buildPlaybackPositionReloadKey(this.data.globalRecentVodItems())
    );

    // Re-fetch on rail change AND on a 30s heartbeat so the progress bar
    // catches the boundary between programs without a full page revisit.
    private readonly liveEpgPrograms = toSignal(
        toObservable(this.liveChannelLookupKeys).pipe(
            switchMap((keys) =>
                keys.length === 0
                    ? of(new Map<string, EpgProgram | null>())
                    : interval(LIVE_EPG_TICK_MS).pipe(
                          startWith(0),
                          switchMap(() =>
                              this.epgService.getCurrentProgramsForChannels(
                                  keys
                              )
                          )
                      )
            )
        ),
        { initialValue: new Map<string, EpgProgram | null>() }
    );

    readonly liveFavoriteCardsEnriched = computed<DashboardRailCard[]>(() =>
        this.enrichLiveCards(this.liveFavoriteCards())
    );

    readonly recentLiveCardsEnriched = computed<DashboardRailCard[]>(() =>
        this.enrichLiveCards(this.recentLiveCards())
    );

    readonly favoriteMoviesAndSeriesCards = computed<DashboardRailCard[]>(() =>
        this.data
            .globalFavoriteItems()
            .filter((item) => item.type === 'movie' || item.type === 'series')
            .slice(0, RAIL_ITEM_LIMIT)
            .map((item) => this.toFavoriteCard(item))
    );

    readonly continueWatchingSeeAllState = computed(() =>
        buildDashboardRailSeeAllState(this.continueWatchingBaseCards())
    );

    readonly favoriteMoviesAndSeriesSeeAllState = computed(() =>
        this.buildNonLiveSeeAllState(this.favoriteMoviesAndSeriesCards())
    );

    readonly liveSeeAllState = buildDashboardCollectionViewState('live');

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
        // populates the rail without a manual dashboard reload. The Xtream
        // recently-added query can be the slowest dashboard worker request on
        // startup, so let favorites claim the worker first.
        effect(() => {
            if (
                this.xtreamPlaylistCount() === 0 ||
                !this.data.globalFavoritesLoaded()
            ) {
                return;
            }

            void this.data.reloadXtreamRecentlyAddedItems(RAIL_ITEM_LIMIT);
        });

        // Reload playback positions when the VOD/series recent set changes.
        // The primitive key keeps live-only recent churn out of the IPC path.
        effect(() => {
            this.playbackPositionReloadKey();
            untracked(() => void this.data.reloadPlaybackPositions());
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

    private enrichLiveCards(
        cards: readonly DashboardRailCard[]
    ): DashboardRailCard[] {
        return cards.map((card) => {
            const details = this.getLiveEpgDetailsForCard(card);
            if (!details) {
                return card;
            }
            return { ...card, ...details };
        });
    }

    private getLiveEpgDetailsForCard(
        card: DashboardRailCard | null
    ): DashboardLiveEpgDetails | null {
        if (!card) {
            return null;
        }
        const program = getLiveEpgProgramForCard(card, this.liveEpgPrograms());
        // Recompute the now-window each tick so progress moves between
        // 30s ticks even if the program identity is unchanged.
        return buildDashboardLiveEpgDetails(program, Date.now());
    }

    private buildNonLiveSeeAllState(
        cards: readonly DashboardRailCard[]
    ): Record<string, unknown> {
        return buildDashboardCollectionViewState(
            cards.some((card) => card.contentType === 'movie')
                ? 'movie'
                : 'series'
        );
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
        const position = this.data.getPlaybackPositionForItem(item);
        const watchProgress = playbackProgressPercent(position);
        const episodeBadge =
            item.type === 'series' &&
            position?.seasonNumber != null &&
            position?.episodeNumber != null
                ? this.translate.instant(
                      'WORKSPACE.DASHBOARD.SEASON_EPISODE_BADGE',
                      {
                          season: position.seasonNumber,
                          episode: position.episodeNumber,
                      }
                  )
                : null;
        return {
            id: `recent-${item.id}-${item.playlist_id}-${item.viewed_at}`,
            title: item.title,
            subtitle: `${this.data.getRecentItemProviderLabel(item)} · ${this.data.getRecentItemTypeLabel(item)}`,
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            epgLookupKey: item.epg_lookup_key,
            link: this.data.getRecentItemLink(item),
            state: this.data.getRecentItemNavigationState(item),
            watchProgress,
            episodeBadge,
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
            epgLookupKey: item.epg_lookup_key,
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
        const deleted =
            await this.playlistDeleteAction.deletePlaylist(playlist);

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
