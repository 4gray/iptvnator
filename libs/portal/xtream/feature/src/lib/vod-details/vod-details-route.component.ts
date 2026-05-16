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
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ContentHeroComponent } from 'components';
import { SafePipe } from '@iptvnator/pipes';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    getPortalPlaybackProgressPercent,
    buildMediaStreamMetadata,
    getMediaMetadataTags,
    getMediaMetadataUnavailableTag,
    mediaMetadataNeedsProbe,
    mergeMediaStreamMetadata,
} from '@iptvnator/portal/shared/util';
import {
    findXtreamVodDuplicateVariants,
    getXtreamVodQualityInfo,
    getXtreamVodVariantKey,
    XtreamStore,
    type XtreamVodDuplicateDecorated,
} from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import {
    DatabaseService,
    DownloadsService,
    ImdbRatingOverridesService,
    MediaMetadataService,
    SettingsStore,
} from 'services';
import {
    MediaStreamMetadata,
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodStream,
    getXtreamVodInfo,
} from 'shared-interfaces';
import {
    buildXtreamVodFallbackViewModel,
    hasUsableXtreamVodMetadata,
} from './vod-details-fallback.util';

type XtreamVodCatalogItem = XtreamVodStream & {
    readonly id?: string | number;
    readonly poster_url?: string;
    readonly title?: string;
};

type XtreamVodVariant = XtreamVodDuplicateDecorated<XtreamVodStream> & {
    readonly id?: string | number;
    readonly imdbId?: string;
    readonly imdb_id?: string;
    readonly movie_data?: Partial<NonNullable<XtreamVodDetails['movie_data']>>;
    readonly o_name?: string;
    readonly title?: string;
};

@Component({
    templateUrl: './vod-details-route.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './vod-details-route.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ContentHeroComponent,
        MatIcon,
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
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly downloadsService = inject(DownloadsService);
    private readonly imdbOverrides = inject(ImdbRatingOverridesService);
    private readonly mediaMetadataService = inject(MediaMetadataService);
    private readonly databaseService = inject(DatabaseService);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly logger = createLogger('VodDetailsRoute');
    private readonly detailsInitDone = signal(false);
    private readonly backdropBackfillKey = signal<string | null>(null);
    private readonly selectedVariantKey = signal<string | null>(null);
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly vodPlaybackPosition = signal<PlaybackPositionData | null>(null);
    readonly probedMediaMetadata = signal<MediaStreamMetadata | null>(null);
    readonly mediaProbePending = signal(false);
    readonly imdbOverrideIdInput = signal('');
    readonly imdbOverrideRatingInput = signal('');
    readonly imdbOverrideTitleInput = signal('');
    readonly imdbOverrideYearInput = signal('');

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedItem = computed(
        () =>
            this.xtreamStore.selectedItem() as unknown as XtreamVodDetails | null
    );
    readonly selectedVodId = computed(() =>
        Number(this.route.snapshot.params.vodId)
    );
    readonly selectedCategory = computed<Partial<XtreamCategory> | null>(() => {
        const categoryId = this.route.snapshot.params.categoryId;
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
    readonly selectedCatalogItem = computed<XtreamVodCatalogItem | null>(() => {
        const vodId = this.selectedVodId();
        if (!Number.isFinite(vodId) || vodId <= 0) {
            return null;
        }

        return (
            (this.xtreamStore.vodStreams().find(
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
            ) as XtreamVodCatalogItem | undefined) ?? null
        );
    });
    readonly duplicateVariants = computed(
        () =>
            findXtreamVodDuplicateVariants(
                this.xtreamStore.vodStreams(),
                this.selectedCatalogItem()
            ) as XtreamVodVariant[]
    );
    readonly hasDuplicateVariants = computed(
        () => this.duplicateVariants().length > 1
    );
    readonly selectedVariant = computed<XtreamVodVariant | null>(() => {
        const variants = this.duplicateVariants();
        const selectedKey = this.selectedVariantKey();

        return (
            variants.find(
                (variant) => getXtreamVodVariantKey(variant) === selectedKey
            ) ??
            variants[0] ??
            this.selectedCatalogItem()
        );
    });
    readonly selectedVariantNumericId = computed(
        () =>
            this.resolveVodNumericId(this.selectedVariant()) ??
            this.selectedVodId()
    );
    readonly selectedVodInfo = computed(() => {
        const item = this.selectedItem();
        return item && hasUsableXtreamVodMetadata(item)
            ? getXtreamVodInfo(item)
            : null;
    });
    readonly imdbOverrideKey = computed(() => {
        const variant = this.selectedVariant();
        const stableKey =
            variant?.duplicateGroupKey ??
            variant?.imdb_id ??
            variant?.imdbId ??
            this.selectedVariantNumericId();
        const key = String(stableKey ?? '').trim();

        return key ? `vod:${key}` : null;
    });
    readonly imdbOverride = computed(() => {
        this.imdbOverrides.revision();
        return this.imdbOverrides.getOverride(this.imdbOverrideKey());
    });
    readonly selectedImdbRating = computed(() => {
        const overrideRating = this.imdbOverride()?.rating;
        if (overrideRating !== undefined) {
            return this.formatImdbRating(overrideRating);
        }

        const catalogItem = this.selectedCatalogItem();
        const detailItem = this.selectedItem() as
            | (XtreamVodDetails & { rating_imdb?: string | number })
            | null;
        const info = this.selectedVodInfo();

        return this.formatImdbRating(
            catalogItem?.imdbRating ??
                catalogItem?.rating_imdb ??
                detailItem?.rating_imdb ??
                info?.rating_imdb
        );
    });
    readonly staticMediaMetadata = computed(() => {
        const item = this.selectedItem();
        const variant = this.selectedVariant();
        const info = item ? getXtreamVodInfo(item) : null;
        return buildMediaStreamMetadata({
            video: info?.video,
            audio: info?.audio,
            subtitles: info?.subtitles ?? info?.subtitle,
            title:
                info?.name ??
                variant?.title ??
                variant?.name ??
                item?.movie_data?.name,
            containerExtension:
                variant?.container_extension ??
                variant?.movie_data?.container_extension ??
                item?.movie_data?.container_extension,
        });
    });
    readonly mediaMetadata = computed(() =>
        mergeMediaStreamMetadata(
            this.staticMediaMetadata(),
            this.probedMediaMetadata()
        )
    );
    readonly mediaMetadataTags = computed(() => {
        const tags = getMediaMetadataTags(this.mediaMetadata());
        if (tags.length > 0) {
            return tags;
        }

        if (this.mediaProbePending()) {
            return ['Analisi qualita...'];
        }

        const unavailableTag = getMediaMetadataUnavailableTag(
            this.probedMediaMetadata()
        );
        if (unavailableTag) {
            return [unavailableTag];
        }

        return tags;
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
    private lastSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;
    private mediaProbeKey: string | null = null;
    private playbackPositionKey: string | null = null;
    private imdbOverrideInputSignature = '';
    readonly matchedExternalPlayback = computed(() => {
        const session = this.externalPlayback.activeSession();
        const vodId = this.selectedVariantNumericId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;

        if (
            !session?.contentInfo ||
            !playlistId ||
            session.status === 'error' ||
            session.status === 'closed'
        ) {
            return null;
        }

        const contentInfo = session.contentInfo;
        if (
            contentInfo.playlistId !== playlistId ||
            contentInfo.contentType !== 'vod' ||
            contentInfo.contentXtreamId !== vodId
        ) {
            return null;
        }

        return session;
    });
    readonly externalPrimaryLabel = computed(() => {
        const session = this.matchedExternalPlayback();
        if (!session) {
            return null;
        }

        const player = session.player.toUpperCase();
        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
            case 'playing':
                return `Stop ${player}`;
            default:
                return null;
        }
    });
    readonly externalPrimaryIcon = computed(() => {
        const session = this.matchedExternalPlayback();
        switch (session?.status) {
            case 'launching':
                return 'hourglass_top';
            case 'opened':
            case 'playing':
                return 'stop_circle';
            default:
                return 'play_arrow';
        }
    });
    readonly isExternalLaunchPending = computed(
        () => this.matchedExternalPlayback()?.status === 'launching'
    );
    readonly isExternalStopAction = computed(() => {
        const status = this.matchedExternalPlayback()?.status;
        return status === 'opened' || status === 'playing';
    });
    readonly externalPrimaryButtonState = computed(() => {
        if (this.isExternalLaunchPending()) {
            return 'launching';
        }

        return this.isExternalStopAction() ? 'stop' : 'idle';
    });
    readonly vodPlaybackProgress = computed(() =>
        getPortalPlaybackProgressPercent(this.vodPlaybackPosition())
    );

    readonly hasPlaybackPosition = computed(() => {
        const inProgress =
            this.vodPlaybackProgress() > 0 && this.vodPlaybackProgress() < 90;
        this.logger.debug('hasPlaybackPosition check', {
            vodId: this.selectedVariantNumericId(),
            inProgress,
        });
        return inProgress;
    });

    readonly isDownloaded = computed(() => {
        const vodId = this.selectedVariantNumericId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(vodId, playlistId, 'vod');
    });

    readonly isDownloading = computed(() => {
        const vodId = this.selectedVariantNumericId();
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) return false;
        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(vodId, playlistId, 'vod');
    });

    constructor() {
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = Number(this.route.snapshot.params.vodId);
            if (!playlistId || this.detailsInitDone()) return;
            this.initializeVodDetails(playlistId, vodId);
            this.detailsInitDone.set(true);
        });

        effect(() => {
            const variants = this.duplicateVariants();
            const selectedKey = this.selectedVariantKey();

            if (variants.length === 0) {
                if (selectedKey !== null) {
                    this.selectedVariantKey.set(null);
                }
                return;
            }

            if (
                !selectedKey ||
                !variants.some(
                    (variant) => getXtreamVodVariantKey(variant) === selectedKey
                )
            ) {
                this.selectedVariantKey.set(
                    getXtreamVodVariantKey(variants[0])
                );
            }
        });

        effect(() => {
            const key = this.imdbOverrideKey();
            const override = this.imdbOverride();
            const signature = [
                key ?? '',
                override?.imdbId ?? '',
                override?.rating ?? '',
                override?.title ?? '',
                override?.year ?? '',
            ].join('|');

            if (signature === this.imdbOverrideInputSignature) {
                return;
            }

            this.imdbOverrideInputSignature = signature;
            this.imdbOverrideIdInput.set(override?.imdbId ?? '');
            this.imdbOverrideRatingInput.set(
                override?.rating !== undefined ? String(override.rating) : ''
            );
            this.imdbOverrideTitleInput.set(override?.title ?? '');
            this.imdbOverrideYearInput.set(
                override?.year !== undefined ? String(override.year) : ''
            );
        });

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVariantNumericId();
            if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) {
                return;
            }

            void this.loadVodPlaybackPosition(playlistId, vodId);
        });

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = Number(this.route.snapshot.params.vodId);
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

        effect(() => {
            const item = this.selectedItem();
            const vodId = this.selectedVariantNumericId();
            const staticMetadata = this.staticMediaMetadata();
            const playableItem = item
                ? this.createVodDetailsForVariant(item, this.selectedVariant())
                : null;
            const streamUrl = playableItem
                ? this.xtreamStore.constructVodStreamUrl(playableItem)
                : '';

            if (!streamUrl) {
                this.mediaProbeKey = null;
                this.mediaProbePending.set(false);
                this.probedMediaMetadata.set(null);
                return;
            }

            if (!mediaMetadataNeedsProbe(staticMetadata)) {
                this.mediaProbeKey = null;
                this.mediaProbePending.set(false);
                this.probedMediaMetadata.set(null);
                this.xtreamStore.setContentMediaMetadata({
                    contentType: 'vod',
                    xtreamId: vodId,
                    metadata: staticMetadata,
                });
                this.persistMediaMetadata(vodId, staticMetadata);
                return;
            }

            if (this.mediaProbeKey === streamUrl) {
                return;
            }

            this.mediaProbeKey = streamUrl;
            this.mediaProbePending.set(true);
            this.probedMediaMetadata.set(null);
            void this.mediaMetadataService
                .probe({
                    url: streamUrl,
                    headers: this.buildPlaylistHeaders(),
                })
                .then((metadata) => {
                    if (this.mediaProbeKey === streamUrl) {
                        this.mediaProbePending.set(false);
                        this.probedMediaMetadata.set(metadata);
                        const mergedMetadata = mergeMediaStreamMetadata(
                            metadata,
                            staticMetadata
                        );
                        this.xtreamStore.setContentMediaMetadata({
                            contentType: 'vod',
                            xtreamId: vodId,
                            metadata: mergedMetadata,
                        });
                        this.persistMediaMetadata(vodId, mergedMetadata);
                    }
                });
        });

        if (window.electron?.onPlaybackPositionUpdate) {
            this.unsubscribePositionUpdates =
                window.electron.onPlaybackPositionUpdate(
                    (data: PlaybackPositionData) => {
                        const playlistId =
                            this.xtreamStore.currentPlaylist()?.id;
                        const vodId = this.selectedVariantNumericId();

                        if (
                            data.contentType !== 'vod' ||
                            data.playlistId !== playlistId ||
                            data.contentXtreamId !== vodId
                        ) {
                            return;
                        }

                        this.vodPlaybackPosition.set(data);
                    }
                );
        }
    }

    ngOnInit(): void {
        const currentPlaylist = this.xtreamStore.currentPlaylist();
        if (!currentPlaylist?.id) {
            this.logger.warn('Deferring VOD details init: playlist not ready');
            return;
        }
        this.initializeVodDetails(
            currentPlaylist.id,
            Number(this.route.snapshot.params.vodId)
        );
        this.detailsInitDone.set(true);
    }

    ngOnDestroy(): void {
        this.inlinePlayback.set(null);
        this.unsubscribePositionUpdates?.();
        this.xtreamStore.setSelectedItem(null);
    }

    playVod(vodItem: XtreamVodDetails): void {
        const playableItem = this.createVodDetailsForVariant(
            vodItem,
            this.selectedVariant()
        );
        const info = getXtreamVodInfo(playableItem);
        this.addToRecentlyViewed();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(playableItem);
        const id = this.selectedVariantNumericId();

        this.logger.debug('playVod resolved ID', { id, vodItem: playableItem });

        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: id,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: info?.name ?? playableItem.movie_data?.name,
            thumbnail: info?.movie_image,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    resumeVod(vodItem: XtreamVodDetails): void {
        const playableItem = this.createVodDetailsForVariant(
            vodItem,
            this.selectedVariant()
        );
        const info = getXtreamVodInfo(playableItem);
        this.addToRecentlyViewed();
        const vodId = this.selectedVariantNumericId();
        const position = this.vodPlaybackPosition();
        const streamUrl = this.xtreamStore.constructVodStreamUrl(playableItem);

        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: vodId,
            contentType: 'vod',
        };
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: info?.name ?? playableItem.movie_data?.name,
            thumbnail: info?.movie_image,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    onPrimaryAction(vodItem: XtreamVodDetails): void {
        if (this.isExternalStopAction()) {
            void this.stopExternalPlayback();
            return;
        }

        if (this.hasPlaybackPosition()) {
            this.resumeVod(vodItem);
            return;
        }

        this.playVod(vodItem);
    }

    selectVodVariant(variant: XtreamVodVariant): void {
        this.selectedVariantKey.set(getXtreamVodVariantKey(variant));
        this.closeInlinePlayer();
    }

    isSelectedVariant(variant: XtreamVodVariant): boolean {
        return getXtreamVodVariantKey(variant) === this.selectedVariantKey();
    }

    variantKey(variant: XtreamVodVariant): string {
        return getXtreamVodVariantKey(variant);
    }

    variantTitle(variant: XtreamVodVariant): string {
        return (
            variant.title ??
            variant.name ??
            variant.o_name ??
            variant.movie_data?.name ??
            `Stream ${getXtreamVodVariantKey(variant)}`
        );
    }

    variantQualityLabel(variant: XtreamVodVariant): string {
        return (
            variant.duplicateQualityLabel ??
            getXtreamVodQualityInfo(variant).label
        );
    }

    setImdbOverrideInput(
        field: 'imdbId' | 'rating' | 'title' | 'year',
        event: Event
    ): void {
        const value = (event.target as HTMLInputElement | null)?.value ?? '';

        switch (field) {
            case 'imdbId':
                this.imdbOverrideIdInput.set(value);
                break;
            case 'rating':
                this.imdbOverrideRatingInput.set(value);
                break;
            case 'title':
                this.imdbOverrideTitleInput.set(value);
                break;
            case 'year':
                this.imdbOverrideYearInput.set(value);
                break;
        }
    }

    saveImdbOverride(): void {
        const key = this.imdbOverrideKey();
        if (!key) {
            return;
        }

        const rating = this.parseOptionalRating(this.imdbOverrideRatingInput());
        if (rating === null) {
            this.snackBar.open(
                this.translateService.instant('XTREAM.IMDB_OVERRIDE_INVALID'),
                null,
                { duration: 3000 }
            );
            return;
        }

        this.imdbOverrides.setOverride(key, {
            imdbId: this.imdbOverrideIdInput(),
            rating,
            title: this.imdbOverrideTitleInput(),
            year: this.parseOptionalYear(this.imdbOverrideYearInput()),
        });
        this.snackBar.open(
            this.translateService.instant('XTREAM.IMDB_OVERRIDE_SAVED'),
            null,
            { duration: 2200 }
        );
    }

    clearImdbOverride(): void {
        this.imdbOverrides.clearOverride(this.imdbOverrideKey());
        this.imdbOverrideIdInput.set('');
        this.imdbOverrideRatingInput.set('');
        this.imdbOverrideTitleInput.set('');
        this.imdbOverrideYearInput.set('');
        this.snackBar.open(
            this.translateService.instant('XTREAM.IMDB_OVERRIDE_CLEARED'),
            null,
            { duration: 2200 }
        );
    }

    async stopExternalPlayback(): Promise<void> {
        await this.externalPlayback.closeSession(
            this.matchedExternalPlayback()
        );
    }

    formatPosition(): string {
        const position = this.vodPlaybackPosition();
        if (!position) return '';

        const date = new Date(0);
        date.setSeconds(position.positionSeconds);
        const timeString = date.toISOString().substr(11, 8);
        return timeString.startsWith('00:') ? timeString.substr(3) : timeString;
    }

    toggleFavorite(): void {
        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.vodId,
            this.xtreamStore.currentPlaylist().id,
            'movie',
            this.selectedVodInfo()?.backdrop_path?.[0]
        );
    }

    goBack(): void {
        this.closeInlinePlayer();
        this.location.back();
    }

    closeInlinePlayer(): void {
        this.inlinePlayback.set(null);
        this.lastSaveTime = 0;
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        const playback = this.inlinePlayback();
        if (!playback?.contentInfo) return;

        const now = Date.now();
        if (now - this.lastSaveTime <= 15000) return;

        this.lastSaveTime = now;
        const position: PlaybackPositionData = {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        };
        void this.playbackPositions.savePlaybackPosition(
            playback.contentInfo.playlistId,
            position
        );
        this.vodPlaybackPosition.set(position);
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

    async downloadVod(vodItem: XtreamVodDetails): Promise<void> {
        const playableItem = this.createVodDetailsForVariant(
            vodItem,
            this.selectedVariant()
        );
        const info = getXtreamVodInfo(playableItem);
        const streamUrl = this.xtreamStore.constructVodStreamUrl(playableItem);
        const id = this.selectedVariantNumericId();

        const playlist = this.xtreamStore.currentPlaylist();

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: id,
            contentType: 'vod',
            title: info?.name ?? playableItem.movie_data?.name ?? 'Unknown',
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
        const vodId = this.selectedVariantNumericId();
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

    private createVodDetailsForVariant(
        vodItem: XtreamVodDetails,
        variant: XtreamVodVariant | null | undefined
    ): XtreamVodDetails {
        const variantId = this.resolveVodNumericId(variant);
        const containerExtension =
            variant?.container_extension ??
            variant?.movie_data?.container_extension ??
            vodItem.movie_data?.container_extension;

        return {
            ...vodItem,
            ...(variant ?? {}),
            movie_data: {
                ...vodItem.movie_data,
                ...variant?.movie_data,
                stream_id: variantId ?? vodItem.movie_data?.stream_id,
                name:
                    variant?.title ??
                    variant?.name ??
                    variant?.movie_data?.name ??
                    vodItem.movie_data?.name,
                container_extension: containerExtension,
            },
        } as XtreamVodDetails;
    }

    private resolveVodNumericId(
        item: XtreamVodVariant | null | undefined
    ): number | undefined {
        const value =
            item?.stream_id ??
            item?.xtream_id ??
            item?.id ??
            item?.movie_data?.stream_id;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    private addToRecentlyViewed(): void {
        this.xtreamStore.addRecentItem({
            xtreamId: Number(this.route.snapshot.params.vodId),
            contentType: 'movie',
            playlist: this.xtreamStore.currentPlaylist,
            backdropUrl: this.selectedVodInfo()?.backdrop_path?.[0],
        });
    }

    private buildPlaylistHeaders(): Record<string, string> {
        const playlist = this.xtreamStore.currentPlaylist();
        const headers: Record<string, string> = {};

        if (playlist?.userAgent) {
            headers['User-Agent'] = playlist.userAgent;
        }
        if (playlist?.referrer) {
            headers.Referer = playlist.referrer;
        }
        if (playlist?.origin) {
            headers.Origin = playlist.origin;
        }

        return headers;
    }

    private initializeVodDetails(playlistId: string, vodId: number): void {
        const { categoryId } = this.route.snapshot.params;
        this.xtreamStore.fetchVodDetailsWithMetadata({
            vodId: String(vodId),
            categoryId,
        });
        this.xtreamStore.checkFavoriteStatus(vodId, playlistId, 'movie');
    }

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.lastSaveTime = 0;
        if (this.portalPlayer.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        void this.portalPlayer.openResolvedPlayback(playback, true);
    }

    private async loadVodPlaybackPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        const positionKey = `${playlistId}:${vodId}`;
        if (this.playbackPositionKey === positionKey) {
            return;
        }

        this.playbackPositionKey = positionKey;
        const position = await this.playbackPositions.getPlaybackPosition(
            playlistId,
            vodId,
            'vod'
        );
        if (this.playbackPositionKey === positionKey) {
            this.vodPlaybackPosition.set(position);
        }
    }

    private persistMediaMetadata(
        vodId: number,
        metadata: MediaStreamMetadata | null
    ): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId || !metadata) {
            return;
        }

        void this.databaseService.setXtreamContentMediaMetadata(
            String(playlistId),
            'movie',
            vodId,
            metadata
        );
    }

    private formatImdbRating(value: unknown): string | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value.toFixed(1);
        }

        if (typeof value !== 'string') {
            return undefined;
        }

        const match = value
            .trim()
            .replace(',', '.')
            .match(/\d+(\.\d+)?/);
        if (!match) {
            return undefined;
        }

        const rating = Number.parseFloat(match[0]);
        return Number.isFinite(rating) ? rating.toFixed(1) : undefined;
    }

    private parseOptionalRating(value: string): number | undefined | null {
        const normalized = value.trim().replace(',', '.');
        if (!normalized) {
            return undefined;
        }

        const rating = Number.parseFloat(normalized);
        if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
            return null;
        }

        return rating;
    }

    private parseOptionalYear(value: string): number | undefined {
        const year = Number.parseInt(value.trim(), 10);
        return Number.isFinite(year) && year > 1800 ? year : undefined;
    }
}
