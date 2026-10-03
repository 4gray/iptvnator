import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import {
    getPlaylistSourceIcon,
    isStalkerAccountPlaylist,
    isXtreamAccountPlaylist,
    normalizeDashboardRailsSettings,
    playlistDisplayLabel,
} from '@iptvnator/shared/interfaces';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { isPortalPlaybackWatched } from '@iptvnator/portal/shared/util';
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
    buildDashboardPortalLiveEpgKey,
    DashboardRecommendationItem,
    DashboardRecommendationsService,
    DashboardSourceExpiryService,
    DashboardTrendingItem,
    DashboardTrendingService,
    GlobalRecentItem,
    resolveSourceExpiryBadge,
} from '@iptvnator/workspace/dashboard/data-access';
import { createDashboardRailSkeletons } from './dashboard-rail-skeletons';
import { DashboardRailComponent } from './dashboard-rail.component';
import type {
    DashboardRailCard,
    DashboardRailActionSelection,
} from './dashboard-rail.component';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { DashboardPortalLiveEpgPresenter } from './dashboard-portal-live-epg.presenter';
import { DashboardHeroComponent } from './dashboard-hero.component';
import { buildLiveEpgCardsForEnabledRails } from './dashboard-live-epg.utils';
import { DashboardLiveEpgPresenter } from './dashboard-live-epg.presenter';
import { DashboardLiveEpgClock } from './dashboard-live-epg-clock';
import { createSourceExpiryClock } from './dashboard-source-expiry-clock';
import {
    buildDashboardEpisodeBadge,
    buildPlaybackPositionReloadKey,
    formatRemainingLabel,
    isContinueWatchingRecentItem,
    playbackProgressPercent,
} from './dashboard-playback.utils';
import {
    buildDashboardCollectionViewState,
    buildDashboardContinueWatchingActions,
    buildDashboardRailSeeAllState,
    buildDashboardSourceActions,
    liveRailTitleKeyForSource,
    RAIL_ITEM_LIMIT,
    shouldShowLiveFavoritesSkeleton,
    shouldShowRecentContentSkeleton,
    SKELETON_CARDS_PER_RAIL,
    SKELETON_RAILS,
} from './dashboard-rail.utils';
import type {
    DashboardContinueWatchingActionId,
    DashboardSourceActionId,
} from './dashboard-rail.utils';

@Component({
    selector: 'lib-workspace-dashboard-rails',
    imports: [
        DashboardHeroComponent,
        DashboardRailComponent,
        EmptyStateComponent,
        TranslatePipe,
    ],
    templateUrl: './workspace-dashboard-rails.component.html',
    styleUrl: './workspace-dashboard-rails.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[class.rails-page-host--empty]': 'ready() && !hasPlaylists()',
    },
    providers: [
        DashboardLiveEpgClock,
        DashboardLiveEpgPresenter,
        DashboardPortalLiveEpgPresenter,
    ],
})
export class WorkspaceDashboardRailsComponent {
    readonly data = inject(DashboardDataService);
    /** One facade for both live-EPG sources: uploaded XMLTV and the portal. */
    readonly liveEpg = inject(DashboardLiveEpgPresenter);
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly playlistDeleteAction = inject(PlaylistDeleteActionService);
    private readonly playlistRefreshAction = inject(
        PlaylistRefreshActionService
    );
    private readonly router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    private readonly shellActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly sourceExpiry = inject(DashboardSourceExpiryService);
    readonly trendingService = inject(DashboardTrendingService);
    readonly recommendationsService = inject(DashboardRecommendationsService);

    readonly hasPlaylists = computed(() => this.data.playlists().length > 0);
    readonly ready = this.data.dashboardReady;
    readonly xtreamPlaylistCount = this.data.xtreamPlaylistCount;
    readonly isElectron = this.runtime.isElectron;

    readonly skeletonSlots = SKELETON_CARDS_PER_RAIL;
    readonly skeletonRails = SKELETON_RAILS;
    readonly liveRailTitleKeyForSource = liveRailTitleKeyForSource;
    readonly dashboardRails = computed(() =>
        normalizeDashboardRailsSettings(this.settingsStore.dashboardRails?.())
    );

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

    // The live cards whose rails are enabled; the presenter adds the hero's
    // live candidates and looks the programmes up per XMLTV source scope.
    private readonly enabledLiveCards = computed(() =>
        buildLiveEpgCardsForEnabledRails(
            this.dashboardRails(),
            this.liveFavoriteCards(),
            this.recentLiveCards()
        )
    );

    private readonly playbackPositionReloadKey = computed(() =>
        buildPlaybackPositionReloadKey(this.data.globalRecentVodItems())
    );

    readonly liveFavoriteCardsEnriched = computed<DashboardRailCard[]>(() =>
        this.liveEpg.enrich(this.liveFavoriteCards())
    );

    readonly recentLiveCardsEnriched = computed<DashboardRailCard[]>(() =>
        this.liveEpg.enrich(this.recentLiveCards())
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

    readonly trendingCards = computed<DashboardRailCard[]>(() => {
        this.languageTick();
        // isAvailable reads the TMDB settings signal — flipping the
        // opt-in off mid-session hides the rail immediately
        if (!this.trendingService.isAvailable) {
            return [];
        }
        return this.trendingService
            .items()
            .map((item) => this.toTrendingCard(item));
    });

    readonly recommendationCards = computed<DashboardRailCard[]>(() => {
        if (!this.recommendationsService.isAvailable) {
            return [];
        }
        return this.recommendationsService
            .items()
            .map((item) => this.toRecommendationCard(item));
    });

    readonly recommendationsRailLabel = computed<string>(() => {
        this.languageTick();
        const seeds = this.recommendationsService.seedTitles();
        // A single contributing seed earns the honest Netflix-style header;
        // a mixed rail falls back to the generic one.
        return seeds.length === 1
            ? this.translate.instant(
                  'WORKSPACE.DASHBOARD.TMDB_RECOMMENDED_BECAUSE',
                  { title: seeds[0] }
              )
            : this.t('WORKSPACE.DASHBOARD.TMDB_RECOMMENDED');
    });

    // resolveSourceExpiryBadge reads the wall clock, so a dashboard left
    // open needs a reactive clock to cross a day-countdown or expiration
    // boundary. It moves only at those boundaries, not on a polling tick.
    private readonly sourceExpiryNow = createSourceExpiryClock(
        this.sourceExpiry.facts,
        computed(() => this.dashboardRails().recentSources)
    );

    readonly sourceCards = computed<DashboardRailCard[]>(() => {
        // Explicit language dependency for the translate.instant() calls
        // below (title fallback, expiry-badge labels). getPlaylistProvider
        // also reads the data service's language tick, but the labels must
        // not rely on that indirection surviving refactors.
        this.languageTick();
        return this.data.recentPlaylists().map((playlist) => ({
            id: playlist._id,
            title:
                playlist.title ||
                playlist.filename ||
                this.t('WORKSPACE.DASHBOARD.UNTITLED_SOURCE'),
            subtitle: this.data.getPlaylistProvider(playlist),
            icon: getPlaylistSourceIcon(playlist),
            link: this.data.getPlaylistLink(playlist),
            actions: buildDashboardSourceActions(
                playlist,
                this.playlistRefreshAction.canRefresh(playlist)
            ),
            expiryBadge: this.buildSourceExpiryBadge(playlist._id),
        }));
    });

    /** Per-rail skeleton gates; see createDashboardRailSkeletons. */
    readonly railSkeletons = createDashboardRailSkeletons(this);

    constructor() {
        // Re-entering the dashboard should pick up any DB-backed recent/favorite
        // changes made while viewing details, including newly backfilled
        // backdrops that do not change recency ordering.
        void this.data.reloadGlobalRecentItems();
        void this.data.reloadGlobalFavorites();

        this.liveEpg.connect(this.enabledLiveCards);

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

        // Subscription-expiry badges for the source cards. Xtream rides the
        // shared PortalStatusService cache; Stalker reads the import-time
        // snapshot (memoized per playlist), so this stays cheap on re-entry.
        // Gated on the sources rail being enabled — with the rail hidden no
        // badge can render, so the status checks would be pure waste.
        effect(() => {
            if (!this.dashboardRails().recentSources) {
                return;
            }
            const playlists = this.data.recentPlaylists();
            untracked(() => void this.sourceExpiry.refresh(playlists));
        });

        // Trending rail: needs the TMDB opt-in and the Electron DB worker.
        // Deferred until the dashboard's own recent/favorites data is in so
        // the batched title match never competes for the worker at startup.
        effect(() => {
            if (
                !this.dashboardRails().tmdbTrending ||
                !this.data.globalFavoritesLoaded()
            ) {
                return;
            }
            untracked(() => void this.trendingService.load());
        });

        // Recommendations rail: same gating as trending, plus tracked
        // reads of the seed source, the favorites (both feed the
        // exclusion set) and the playlist set (feeds the catalog key) so
        // a newly watched/favorited title or an imported/deleted playlist
        // re-runs the load — the service keys loads by seed + exclusion +
        // catalog set and skips no-ops.
        effect(() => {
            if (
                !this.dashboardRails().tmdbRecommendations ||
                !this.data.globalFavoritesLoaded()
            ) {
                return;
            }
            this.data.globalRecentVodItems();
            this.data.globalFavoriteItems();
            this.data.playlists();
            // Language feeds the service's load key (localized payloads)
            this.languageTick();
            untracked(() => void this.recommendationsService.load());
        });
    }

    onAddPlaylist(type?: WorkspacePlaylistType): void {
        this.shellActions.openAddPlaylistDialog(type);
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
                this.openAccountInfo(playlist);
                break;
            case 'remove':
                this.confirmRemovePlaylist(playlist);
                break;
        }
    }

    onContinueWatchingActionSelected(
        selection: DashboardRailActionSelection
    ): void {
        const item = this.data
            .globalRecentVodItems()
            .find(
                (candidate) =>
                    this.recentCardId(candidate) === selection.card.id
            );

        if (!item) {
            return;
        }

        switch (selection.action.id as DashboardContinueWatchingActionId) {
            case 'resume':
                this.resumeRecentItem(item);
                break;
            case 'mark-watched':
                this.runContinueWatchingMutation(() =>
                    this.data.markRecentItemWatched(item)
                );
                break;
            case 'remove-from-history':
                this.runContinueWatchingMutation(() =>
                    this.data.removeGlobalRecentItem(item)
                );
                break;
        }
    }

    private resumeRecentItem(item: GlobalRecentItem): void {
        const navigation = this.data.getRecentItemResumeNavigation(item);
        if (!navigation) {
            return;
        }
        void this.router.navigate(navigation.link, {
            state: navigation.state,
        });
    }

    /**
     * A rejected persistence write leaves the card unchanged, so tell the
     * user instead of failing silently with an unhandled rejection.
     */
    private runContinueWatchingMutation(
        mutation: () => Promise<unknown>
    ): void {
        mutation().catch(() => {
            this.snackBar.open(
                this.t('WORKSPACE.DASHBOARD.ACTION_FAILED'),
                undefined,
                { duration: 5000 }
            );
        });
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

    private toRecentCard(item: GlobalRecentItem): DashboardRailCard {
        const position = this.data.getPlaybackPositionForItem(item);
        const watchProgress = playbackProgressPercent(position);
        const episodeBadge = buildDashboardEpisodeBadge(
            item,
            position,
            (key, params) => this.translate.instant(key, params)
        );
        return {
            id: this.recentCardId(item),
            title: item.title,
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            epgLookupKey: item.epg_lookup_key,
            epgPlaylistId: item.playlist_id,
            liveEpgSourceKey: buildDashboardPortalLiveEpgKey(item),
            link: this.data.getRecentItemLink(item),
            // Default click is detail-only for every card — an in-progress
            // series no longer auto-plays on click (issue #1441); resuming
            // moved to the ⋮ menu below. The hero CTA keeps the resume state.
            state: this.data.getRecentItemDetailNavigationState(item),
            watchProgress,
            episodeBadge,
            // What still separates one card from the next: where in the
            // show, and how much is left — not which provider it came from.
            remainingLabel: formatRemainingLabel(position),
            ...(item.type === 'movie' || item.type === 'series'
                ? {
                      actions: buildDashboardContinueWatchingActions({
                          canResume:
                              this.data.getRecentItemResumeNavigation(item) !==
                              null,
                          canMarkWatched:
                              !!position?.durationSeconds &&
                              position.durationSeconds > 0 &&
                              !isPortalPlaybackWatched(position),
                      }),
                  }
                : {}),
        };
    }

    private recentCardId(item: GlobalRecentItem): string {
        return `recent-${item.id}-${item.playlist_id}-${item.viewed_at}`;
    }

    private toFavoriteCard(item: DashboardFavoriteItem): DashboardRailCard {
        return {
            id: `fav-${item.id}-${item.playlist_id}-${item.added_at}`,
            title: item.title,
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            epgLookupKey: item.epg_lookup_key,
            epgPlaylistId: item.playlist_id,
            liveEpgSourceKey: buildDashboardPortalLiveEpgKey(item),
            link: this.data.getGlobalFavoriteLink(item),
            state: this.data.getGlobalFavoriteNavigationState(item),
        };
    }

    private toRecentlyAddedCard(
        item: DashboardRecentlyAddedItem
    ): DashboardRailCard {
        return {
            id: `added-${item.id}-${item.playlist_id}-${item.added_at}`,
            title: item.title,
            // "Where was it added" is the one fact that varies per card here.
            subtitle: playlistDisplayLabel(item.playlist_name),
            imageUrl: item.poster_url,
            icon: this.typeIcon(item.type),
            contentType: item.type,
            link: this.data.getRecentlyAddedLink(item),
            state: this.data.getRecentlyAddedNavigationState(item),
        };
    }

    private toTrendingCard(item: DashboardTrendingItem): DashboardRailCard {
        const subtitle = [
            item.year !== null ? String(item.year) : null,
            item.rating ? `★ ${item.rating}` : null,
            item.match?.playlistName ?? null,
        ]
            .filter((value): value is string => Boolean(value))
            .join(' · ');
        return {
            id: `trending-${item.mediaType}-${item.tmdbId}`,
            title: item.title,
            subtitle,
            imageUrl: item.posterUrl ?? undefined,
            icon: item.mediaType === 'movie' ? 'movie' : 'video_library',
            contentType: item.mediaType === 'movie' ? 'movie' : 'series',
            link: item.match
                ? [
                      '/workspace/xtreams',
                      item.match.playlistId,
                      item.match.type === 'movie' ? 'vod' : 'series',
                      String(item.match.categoryId),
                      String(item.match.xtreamId),
                  ]
                : ['/workspace/search'],
            ...(item.match ? {} : { queryParams: { q: item.title } }),
        };
    }

    private toRecommendationCard(
        item: DashboardRecommendationItem
    ): DashboardRailCard {
        const subtitle = [
            item.year !== null ? String(item.year) : null,
            item.rating ? `★ ${item.rating}` : null,
            item.match.playlistName,
        ]
            .filter((value): value is string => Boolean(value))
            .join(' · ');
        return {
            id: `rec-${item.mediaType}-${item.tmdbId}`,
            title: item.title,
            subtitle,
            imageUrl: item.posterUrl ?? undefined,
            icon: item.mediaType === 'movie' ? 'movie' : 'video_library',
            contentType: item.mediaType === 'movie' ? 'movie' : 'series',
            link: [
                '/workspace/xtreams',
                item.match.playlistId,
                item.match.type === 'movie' ? 'vod' : 'series',
                String(item.match.categoryId),
                String(item.match.xtreamId),
            ],
        };
    }

    private buildSourceExpiryBadge(
        playlistId: string
    ): DashboardRailCard['expiryBadge'] {
        // Reactive read: ties the evaluation below to the expiry clock (this
        // method only runs inside the sourceCards computed). Date.now() keeps
        // a recompute for any other reason on the real time.
        const badge = resolveSourceExpiryBadge(
            this.sourceExpiry.facts().get(playlistId),
            Math.max(this.sourceExpiryNow(), Date.now())
        );
        if (!badge) {
            return null;
        }
        return badge.kind === 'expired'
            ? {
                  kind: 'expired',
                  label: this.t('WORKSPACE.DASHBOARD.SOURCE_EXPIRED'),
              }
            : {
                  kind: 'expiring',
                  label: this.translate.instant(
                      'WORKSPACE.DASHBOARD.SOURCE_EXPIRES_IN_DAYS',
                      { days: badge.daysLeft }
                  ),
              };
    }

    private typeIcon(type: 'live' | 'movie' | 'series'): string {
        if (type === 'live') return 'live_tv';
        if (type === 'movie') return 'movie';
        return 'video_library';
    }

    private openAccountInfo(playlist: PlaylistMeta): void {
        if (isXtreamAccountPlaylist(playlist)) {
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
            return;
        }

        if (isStalkerAccountPlaylist(playlist)) {
            this.shellActions.openStalkerAccountInfo({ playlist });
        }
    }

    private confirmRemovePlaylist(playlist: PlaylistMeta): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            confirmLabel: this.translate.instant('HOME.PLAYLISTS.REMOVE'),
            tone: 'destructive',
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
            PlaylistActions.playlistRemovalCommitted({
                playlistId: playlist._id,
            })
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
