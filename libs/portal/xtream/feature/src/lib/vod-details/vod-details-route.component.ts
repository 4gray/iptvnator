import { Location, SlicePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    OnInit,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
} from '@iptvnator/ui/components';
import { SafePipe } from '@iptvnator/pipes';
import { createLogger } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
    DownloadsService,
    SettingsStore,
} from '@iptvnator/services';
import {
    getXtreamVodInfo,
    normalizeTitleKeys,
    TmdbEnrichedCastMember,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodInfo,
    XtreamVodStream,
    youtubeEmbedUrl,
} from '@iptvnator/shared/interfaces';
import {
    SimilarCatalogItem,
    matchRecommendationsToCatalog,
} from '../tmdb-similar.util';
import {
    buildXtreamVodFallbackViewModel,
    hasUsableXtreamVodMetadata,
} from './vod-details-fallback.util';
import { VodDetailsPlaybackService } from './vod-details-playback.service';

@Component({
    templateUrl: './vod-details-route.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './vod-details-route.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [VodDetailsPlaybackService],
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatIcon,
        PortalDetailShellComponent,
        SafePipe,
        SlicePipe,
        TranslateModule,
        PortalInlinePlayerComponent,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly settingsStore = inject(SettingsStore);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly downloadsService = inject(DownloadsService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly playback = inject(VodDetailsPlaybackService);
    private readonly logger = createLogger('VodDetailsRoute');
    /** `playlistId:vodId` of the last initialized detail view */
    private readonly lastInitKey = signal<string | null>(null);
    private readonly backdropBackfillKey = signal<string | null>(null);
    readonly inlinePlayback = this.playback.inlinePlayback;
    readonly vodPlaybackPosition = this.playback.vodPlaybackPosition;

    /**
     * Reactive route params: the component is reused when navigating
     * between two VOD details (e.g. via the Similar rail), so computeds
     * must not read the one-shot snapshot.
     */
    private readonly routeParams = toSignal(this.route.params, {
        initialValue: this.route.snapshot.params,
    });

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = computed(
        () =>
            this.xtreamStore.selectedItem() as unknown as XtreamVodDetails | null
    );
    readonly selectedVodId = computed(() => Number(this.routeParams().vodId));
    readonly selectedCategory = computed<Partial<XtreamCategory> | null>(() => {
        const categoryId = this.routeParams().categoryId;
        if (!categoryId) {
            return null;
        }

        return (
            this.xtreamStore.vodCategories().find(
                (category) =>
                    String(
                        (
                            category as XtreamCategory & {
                                id?: string | number;
                            }
                        ).category_id ??
                            (
                                category as XtreamCategory & {
                                    id?: string | number;
                                }
                            ).id
                    ) === String(categoryId)
            ) ?? null
        );
    });
    readonly selectedCatalogItem = computed<
        | (Partial<XtreamVodStream> & {
              id?: string | number;
              poster_url?: string;
              title?: string;
              xtream_id?: string | number;
          })
        | null
    >(() => {
        const vodId = this.selectedVodId();
        if (!Number.isFinite(vodId) || vodId <= 0) {
            return null;
        }

        return (
            this.xtreamStore.vodStreams().find(
                (item) =>
                    Number(
                        (
                            item as XtreamVodStream & {
                                id?: string | number;
                                xtream_id?: string | number;
                            }
                        ).xtream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).stream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).id
                    ) === vodId
            ) ?? null
        );
    });
    readonly selectedVodInfo = computed(() => {
        const item = this.selectedItem();
        return item && hasUsableXtreamVodMetadata(item)
            ? getXtreamVodInfo(item)
            : null;
    });
    readonly fallbackView = computed(() => {
        const item = this.selectedItem();
        if (!item || this.selectedVodInfo()) {
            return null;
        }

        return buildXtreamVodFallbackViewModel({
            vodDetails: item,
            catalogItem: this.selectedCatalogItem(),
            category: this.selectedCategory(),
            vodId: this.selectedVodId(),
        });
    });
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly matchedExternalPlayback = this.playback.matchedExternalPlayback;
    readonly externalPrimaryLabel = this.playback.externalPrimaryLabel;
    readonly externalPrimaryIcon = this.playback.externalPrimaryIcon;
    readonly isExternalLaunchPending = this.playback.isExternalLaunchPending;
    readonly isExternalStopAction = this.playback.isExternalStopAction;
    readonly externalPrimaryButtonState =
        this.playback.externalPrimaryButtonState;
    readonly vodPlaybackProgress = this.playback.vodPlaybackProgress;
    readonly hasPlaybackPosition = this.playback.hasPlaybackPosition;

    readonly isDownloaded = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(vodId, playlistId, 'vod');
    });

    readonly isDownloading = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(vodId, playlistId, 'vod');
    });

    readonly isPausedDownload = computed(() => {
        const vodId = this.selectedVodId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isPaused(vodId, playlistId, 'vod');
    });

    readonly trailerEmbedUrl = computed(() =>
        youtubeEmbedUrl(this.selectedVodInfo()?.youtube_trailer)
    );

    /** TMDB recommendations matched against the loaded VOD catalog */
    readonly similarItems = computed<SimilarCatalogItem[]>(() => {
        const info = this.selectedVodInfo();
        if (!info?.tmdb_recommendations?.length) {
            return [];
        }
        return matchRecommendationsToCatalog(
            info.tmdb_recommendations,
            this.xtreamStore.vodStreams(),
            { excludeId: this.selectedVodId() }
        );
    });

    /** Recommendations found in the user's OTHER portals (Electron only) */
    private readonly crossPortalItems = signal<CrossPortalSimilarItem[]>([]);
    readonly similarInPortals = computed<CrossPortalSimilarItem[]>(() => {
        const localTitles = new Set(
            this.similarItems().map(
                (item) => normalizeTitleKeys(item.title).exact
            )
        );
        return this.crossPortalItems().filter(
            (item) => !localTitles.has(normalizeTitleKeys(item.title).exact)
        );
    });

    private readonly loadCrossPortalSimilar = effect(() => {
        const recommendations = this.selectedVodInfo()?.tmdb_recommendations;
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        untracked(() => {
            this.crossPortalItems.set([]);
            if (
                !recommendations?.length ||
                !this.crossPortalSimilar.isAvailable
            ) {
                return;
            }
            void this.crossPortalSimilar
                .matchRecommendations(recommendations, 'movie', {
                    excludePlaylistId: playlistId,
                })
                .then((items) => {
                    if (
                        this.selectedVodInfo()?.tmdb_recommendations ===
                        recommendations
                    ) {
                        this.crossPortalItems.set(items);
                    }
                });
        });
    });

    constructor() {
        this.playback.bind({
            vodId: this.selectedVodId,
            vodInfo: this.selectedVodInfo,
        });

        // Initializes on first render and RE-initializes when the route
        // params change while the component is reused (Similar rail).
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVodId();
            if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) return;

            const initKey = `${playlistId}:${vodId}`;
            if (this.lastInitKey() === initKey) return;
            this.lastInitKey.set(initKey);

            this.inlinePlayback.set(null);
            this.vodPlaybackPosition.set(null);
            this.initializeVodDetails(playlistId, vodId);
        });

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVodId();
            const backdropUrl =
                this.selectedVodInfo()?.backdrop_path?.[0]?.trim();

            if (
                !playlistId ||
                !Number.isFinite(vodId) ||
                vodId <= 0 ||
                !backdropUrl
            ) {
                return;
            }

            const backfillKey = `${playlistId}:${vodId}:${backdropUrl}`;
            if (this.backdropBackfillKey() === backfillKey) {
                return;
            }

            this.backdropBackfillKey.set(backfillKey);
            void this.xtreamStore.backfillContentBackdrop({
                xtreamId: vodId,
                contentType: 'movie',
                playlist: this.xtreamStore.currentPlaylist,
                backdropUrl,
            });
        });
    }

    ngOnInit(): void {
        // Initialization is handled by the params-driven effect in the
        // constructor; the hook remains for interface compatibility.
        if (!this.xtreamStore.currentPlaylist()?.id) {
            this.logger.warn('Deferring VOD details init: playlist not ready');
        }
    }

    openSimilarInPortals(item: CrossPortalSimilarItem): void {
        void this.router.navigate(this.crossPortalSimilar.buildLink(item));
    }

    openSimilar(item: SimilarCatalogItem): void {
        void this.router.navigate(['../..', item.categoryId, item.id], {
            relativeTo: this.route,
        });
    }

    openActor(member: TmdbEnrichedCastMember): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId || !member.tmdbPersonId) {
            return;
        }
        void this.router.navigate([
            '/workspace/xtreams',
            playlistId,
            'actor',
            member.tmdbPersonId,
        ]);
    }

    ngOnDestroy(): void {
        this.playback.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
    }

    playVod(vodItem: XtreamVodDetails | null): void {
        this.playback.playVod(vodItem);
    }

    resumeVod(vodItem: XtreamVodDetails | null): void {
        this.playback.resumeVod(vodItem);
    }

    onPrimaryAction(vodItem: XtreamVodDetails | null): void {
        this.playback.onPrimaryAction(vodItem);
    }

    stopExternalPlayback(): Promise<void> {
        return this.playback.stopExternalPlayback();
    }

    formatPosition(): string {
        return this.playback.formatPosition();
    }

    toggleFavorite(): void {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.vodId,
            playlist.id,
            'movie',
            this.selectedVodInfo()?.backdrop_path?.[0]
        );
    }

    getBackdropUrl(info: XtreamVodInfo): string | undefined {
        return info.backdrop_path?.[0];
    }

    goBack(): void {
        this.playback.closeInlinePlayer();
        this.location.back();
    }

    closeInlinePlayer(): void {
        this.playback.closeInlinePlayer();
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.playback.handleInlineTimeUpdate(event);
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            undefined,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.playback.handleExternalFallbackRequest(request);
    }

    async resumePausedDownload(): Promise<void> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }
        await this.downloadsService.resumeDownloadByContent(
            this.selectedVodId(),
            playlistId,
            'vod'
        );
    }

    async downloadVod(vodItem: XtreamVodDetails | null): Promise<void> {
        if (!vodItem) {
            return;
        }

        const info = getXtreamVodInfo(vodItem);
        const streamUrl = this.xtreamStore.constructVodStreamUrl(vodItem);
        const routeVodId = this.route.snapshot.params.vodId;
        const id = routeVodId
            ? Number(routeVodId)
            : Number(
                  vodItem.movie_data?.stream_id ||
                      (vodItem as { stream_id?: number }).stream_id
              );

        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: id,
            contentType: 'vod',
            title: info?.name ?? vodItem.movie_data?.name ?? 'Unknown',
            url: streamUrl,
            posterUrl: info?.movie_image,
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
        });
    }

    async playFromLocal(): Promise<void> {
        const vodId = Number(this.route.snapshot.params.vodId);
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return;

        const filePath = this.downloadsService.getDownloadedFilePath(
            vodId,
            playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }

    private initializeVodDetails(playlistId: string, vodId: number): void {
        const { categoryId } = this.route.snapshot.params;
        this.xtreamStore.fetchVodDetailsWithMetadata({
            vodId: String(vodId),
            categoryId,
        });
        this.xtreamStore.checkFavoriteStatus(vodId, playlistId, 'movie');
        void this.playback.loadPosition(playlistId, vodId);
    }
}
