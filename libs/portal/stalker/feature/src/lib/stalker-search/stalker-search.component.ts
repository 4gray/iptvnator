import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    resource,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { DataService, PlaylistsService } from 'services';
import {
    PlaybackPositionData,
    Playlist,
    ResolvedPortalPlayback,
    STALKER_REQUEST,
    StalkerPortalActions,
    VodDetailsItem,
} from 'shared-interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { ContentCardComponent } from '@iptvnator/portal/shared/ui';
import { SearchLayoutComponent } from '@iptvnator/portal/shared/ui';
import { StalkerInlineDetailComponent } from '../stalker-inline-detail/stalker-inline-detail.component';
import { StalkerContentTypes } from '@iptvnator/portal/stalker/data-access';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    isWorkspaceLayoutRoute,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    StalkerSelectedVodItem,
    StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import {
    buildStalkerSelectedVodItem,
    clearStalkerDetailViewState,
    createStalkerInlineDetailState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    isSelectedStalkerVodFavorite,
    isStalkerSeriesFlag,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';

interface StalkerFilter {
    key: string;
    label: string;
    translationKey: string;
}

interface StalkerSearchResponse {
    js?: {
        data?: StalkerVodSource[];
    };
    message?: string;
    status?: number;
}

@Component({
    selector: 'app-stalker-search',
    imports: [
        ContentCardComponent,
        FormsModule,
        MatCheckboxModule,
        SearchLayoutComponent,
        StalkerInlineDetailComponent,
        TranslatePipe,
    ],
    templateUrl: './stalker-search.component.html',
    styleUrl: './stalker-search.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerSearchComponent {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly dataService = inject(DataService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistService = inject(PlaylistsService);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly logger = createLogger('StalkerSearch');

    readonly filters = signal({
        series: false,
        vod: true,
    });
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.activatedRoute);

    readonly filterConfig: StalkerFilter[] = [
        {
            key: 'vod',
            label: 'Movies',
            translationKey: 'PORTALS.SIDEBAR.MOVIES',
        },
        {
            key: 'series',
            label: 'Series',
            translationKey: 'PORTALS.SIDEBAR.SERIES',
        },
    ];

    readonly searchTerm = signal('');
    readonly routeSearchTerm = queryParamSignal(
        this.activatedRoute,
        'q',
        (value) => (value ?? '').trim()
    );

    private readonly currentPlaylist = computed(() => {
        const playlist = this.playlistContext.activePlaylist();
        return playlist?.macAddress ? playlist : null;
    });

    readonly selectedFilterType = signal('vod');
    private readonly favoritesRefresh = createRefreshTrigger();

    itemDetails: StalkerSelectedVodItem | null = null;
    vodDetailsItem: VodDetailsItem | null = null;
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly selectedVodPosition = signal<PlaybackPositionData | null>(null);
    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.selectedVodPosition()?.positionSeconds ?? null
    );
    private lastInlineSaveTime = 0;

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly searchResultsResource = resource({
        params: () => ({
            contentType: this.selectedFilterType(),
            search: this.searchTerm(),
            action: StalkerPortalActions.GetOrderedList,
        }),
        loader: async ({ params }) => {
            if (params.search.length < 3) {
                return [];
            }
            const playlist = this.currentPlaylist();
            if (!playlist) return [];
            const { portalUrl, macAddress } = playlist;

            let token: string | undefined;
            let serialNumber: string | undefined;
            if ((playlist as Playlist).isFullStalkerPortal) {
                try {
                    const result = await this.stalkerSession.ensureToken(
                        playlist as Playlist
                    );
                    token = result.token ?? undefined;
                    serialNumber = (playlist as Playlist).stalkerSerialNumber;
                } catch (error) {
                    this.logger.error('Failed to get stalker token', error);
                }
            }

            const response =
                await this.dataService.sendIpcEvent<StalkerSearchResponse>(
                    STALKER_REQUEST,
                    {
                        url: portalUrl,
                        macAddress,
                        params: {
                            action: StalkerContentTypes[params.contentType]
                                .getContentAction,
                            type: params.contentType,
                            search: params.search,
                            max_page_items: 100,
                        },
                        token,
                        serialNumber,
                    }
                );
            if (response) {
                const items = response.js?.data || [];
                return items.map((item: StalkerVodSource) =>
                    this.processItemUrls(item, portalUrl)
                );
            } else {
                throw new Error(
                    `Error: ${response.message} (Status: ${response.status})`
                );
            }
        },
    });

    readonly isSelectedVodFavorite = signal<boolean>(false);

    constructor() {
        effect(() => {
            const routeTerm = this.routeSearchTerm();
            if (routeTerm !== this.searchTerm()) {
                this.searchTerm.set(routeTerm);
            }
        });

        effect(() => {
            // Re-evaluate favorite state whenever favorites resource changes.
            this.portalFavorites.value();
            this.syncSelectedVodFavorite();
        });
    }

    /** Check if showing item details */
    get showingDetails(): boolean {
        return this.inlineDetail().categoryId !== null;
    }

    /** Get results count for layout */
    get resultsCount(): number {
        return this.searchResultsResource.value()?.length ?? 0;
    }

    updateSearchTerm(term: string) {
        this.searchTerm.set(term);
    }

    updateFilter(key: string, value: boolean) {
        if (value) {
            // Single selection mode - set clicked filter, disable others
            this.selectedFilterType.set(key);
            this.filters.update((f) => {
                const newFilters: Record<string, boolean> = {};
                Object.keys(f).forEach((k) => {
                    newFilters[k] = k === key;
                });
                return newFilters as typeof f;
            });
        }
    }

    selectItem(item: StalkerVodSource) {
        this.closeInlinePlayer();
        const hasEmbeddedSeries = item.series?.length > 0;
        const needsSeriesFetch =
            this.selectedFilterType() === 'vod' &&
            !hasEmbeddedSeries &&
            isStalkerSeriesFlag(item.is_series);

        this.itemDetails = buildStalkerSelectedVodItem(item, needsSeriesFetch);

        this.stalkerStore.setSelectedItem(this.itemDetails);

        switch (this.selectedFilterType()) {
            case 'vod':
                this.stalkerStore.setSelectedContentType('vod');
                if (!hasEmbeddedSeries && !needsSeriesFetch) {
                    const detailViewState = createStalkerDetailViewState(
                        this.itemDetails,
                        this.currentPlaylist()?._id ?? ''
                    );
                    this.itemDetails = detailViewState.itemDetails;
                    this.vodDetailsItem = detailViewState.vodDetailsItem;
                    this.syncSelectedVodFavorite();
                    void this.loadSelectedVodPosition(
                        this.currentPlaylist()?._id ?? '',
                        Number(detailViewState.itemDetails?.id)
                    );
                } else {
                    const cleared = clearStalkerDetailViewState();
                    this.vodDetailsItem = cleared.vodDetailsItem;
                    this.isSelectedVodFavorite.set(false);
                    this.selectedVodPosition.set(null);
                }
                break;
            case 'series':
                this.stalkerStore.setSelectedContentType('series');
                break;
            default:
                break;
        }
    }

    onVodPlay(item: VodDetailsItem): void {
        if (item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image
            );
        }
    }

    onVodResume(event: {
        item: VodDetailsItem;
        positionSeconds: number;
    }): void {
        if (event.item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                event.item.cmd,
                event.item.data.info?.name,
                event.item.data.info?.movie_image,
                event.positionSeconds
            );
        }
    }

    onVodFavoriteToggled(event: {
        item: VodDetailsItem;
        isFavorite: boolean;
    }): void {
        toggleStalkerVodFavorite(event, {
            addToFavorites: (item, onDone) => this.addToFavorites(item, onDone),
            removeFromFavorites: (favoriteId, onDone) =>
                this.removeFromFavorites(favoriteId, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
            },
        });
    }

    onVodBack(): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails = cleared.itemDetails;
        this.vodDetailsItem = cleared.vodDetailsItem;
        this.isSelectedVodFavorite.set(false);
        this.selectedVodPosition.set(null);
        this.closeInlinePlayer();
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) {
            return;
        }

        const now = Date.now();
        if (now - this.lastInlineSaveTime <= 15000) {
            return;
        }

        this.lastInlineSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };

        void this.playbackPositions.savePlaybackPosition(
            playback.contentInfo.playlistId,
            position
        );
        this.selectedVodPosition.set(position);
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.lastInlineSaveTime = 0;
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            null,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        void this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
    }

    removeFromFavorites(favoriteId: string, onDone?: () => void) {
        this.stalkerStore.removeFromFavorites(favoriteId, onDone);
    }

    addToFavorites(item: Record<string, unknown>, onDone?: () => void) {
        this.stalkerStore.addToFavorites(item, onDone);
    }

    private syncSelectedVodFavorite(): void {
        const item = this.vodDetailsItem;
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                item,
                this.portalFavorites.value() ?? []
            )
        );
    }

    inlineDetail() {
        return createStalkerInlineDetailState(
            this.itemDetails,
            this.vodDetailsItem,
            this.selectedFilterType() === 'series' ? 'series' : 'vod'
        );
    }

    private processItemUrls(
        item: StalkerVodSource,
        portalUrl: string
    ): StalkerVodSource {
        const processed = { ...item };

        if (processed.screenshot_uri) {
            processed.screenshot_uri = this.makeAbsoluteUrl(
                portalUrl,
                processed.screenshot_uri
            );
        }

        return processed;
    }

    private makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
        if (!relativePath) return '';
        if (
            relativePath.startsWith('http://') ||
            relativePath.startsWith('https://')
        ) {
            return relativePath;
        }
        try {
            const url = new URL(baseUrl);
            const path = relativePath.startsWith('/')
                ? relativePath
                : `/${relativePath}`;
            return `${url.origin}${path}`;
        } catch {
            return relativePath;
        }
    }

    private async startStalkerVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        try {
            const playback =
                startTime === undefined
                    ? await this.stalkerStore.resolveVodPlayback(
                          cmd,
                          title,
                          thumbnail
                      )
                    : await this.stalkerStore.resolveVodPlayback(
                          cmd,
                          title,
                          thumbnail,
                          undefined,
                          undefined,
                          startTime
                      );

            this.lastInlineSaveTime = 0;
            if (this.portalPlayer.isEmbeddedPlayer()) {
                this.inlinePlayback.set(playback);
                return;
            }

            this.closeInlinePlayer();
            void this.portalPlayer.openResolvedPlayback(playback, true);
        } catch (error) {
            this.logger.error('Failed to start search VOD playback', error);
            const errorMessage =
                error instanceof Error && error.message === 'nothing_to_play'
                    ? this.translateService.instant(
                          'PORTALS.CONTENT_NOT_AVAILABLE'
                      )
                    : this.translateService.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, null, {
                duration: 3000,
            });
        }
    }

    private async loadSelectedVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        if (!playlistId || !Number.isFinite(vodId)) {
            this.selectedVodPosition.set(null);
            return;
        }

        const position = await this.playbackPositions.getPlaybackPosition(
            playlistId,
            vodId,
            'vod'
        );
        this.selectedVodPosition.set(position ?? null);
    }
}
