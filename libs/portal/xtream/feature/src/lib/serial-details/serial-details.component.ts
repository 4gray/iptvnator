import { Location, SlicePipe } from '@angular/common';
import {
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    ContentHeroComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerXtreamDownloadContext,
} from 'components';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    getSeriesQuickStartAction,
    getMediaMetadataTags,
} from '@iptvnator/portal/shared/util';
import {
    findXtreamSeriesDuplicateVariants,
    getXtreamSeriesVariantKey,
    getXtreamVodQualityInfo,
    XtreamStore,
    type XtreamVodDuplicateDecorated,
} from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import { ImdbRatingOverridesService } from 'services';
import {
    MediaStreamMetadata,
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
    XtreamSerieDetails,
    XtreamSerieItem,
} from 'shared-interfaces';

type XtreamSerieDetailsView = XtreamSerieDetails & {
    readonly series_id: number;
};

type XtreamSeriesCatalogItem = XtreamSerieItem & {
    readonly id?: string | number;
    readonly title?: string;
    readonly xtream_id?: string | number;
};

type XtreamSeriesVariant = XtreamVodDuplicateDecorated<XtreamSerieItem> & {
    readonly id?: string | number;
    readonly imdbId?: string;
    readonly imdb_id?: string;
    readonly o_name?: string;
    readonly title?: string;
    readonly xtream_id?: string | number;
};

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './serial-details.component.scss',
    ],
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                min-height: 0;
            }
        `,
    ],
    imports: [
        ContentHeroComponent,
        MatIcon,
        PortalInlinePlayerComponent,
        SeasonContainerComponent,
        SlicePipe,
        TranslatePipe,
    ],
})
export class SerialDetailsComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly imdbOverrides = inject(ImdbRatingOverridesService);

    readonly selectedItem = signal<XtreamSerieDetailsView | null>(null);
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly seriesEpisodeMediaMetadata = signal<MediaStreamMetadata | null>(
        null
    );
    readonly imdbOverrideIdInput = signal('');
    readonly imdbOverrideRatingInput = signal('');
    readonly imdbOverrideTitleInput = signal('');
    readonly imdbOverrideYearInput = signal('');
    readonly episodePlaybackPositions = signal<
        Map<number, PlaybackPositionData>
    >(new Map());
    readonly currentPlaylistId = signal('');
    readonly xtreamDownloadContext =
        signal<SeasonContainerXtreamDownloadContext | null>(null);
    private readonly detailsInitDone = signal(false);
    private readonly backdropBackfillKey = signal<string | null>(null);
    private readonly selectedVariantKey = signal<string | null>(null);
    private lastSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;
    readonly openingEpisodeId = signal<number | null>(null);
    readonly activeEpisodeId = signal<number | null>(null);
    readonly quickStartAction = computed(() => {
        const item = this.selectedItem();
        if (!item) {
            return null;
        }

        return getSeriesQuickStartAction({
            seasons: item.episodes ?? {},
            playbackPositions: this.episodePlaybackPositions(),
        });
    });
    readonly mediaMetadataTags = computed(() => {
        return getMediaMetadataTags(this.seriesEpisodeMediaMetadata());
    });
    readonly selectedSeriesId = computed(() =>
        Number(this.route.snapshot.params.serialId)
    );
    readonly selectedCatalogItem = computed<XtreamSeriesCatalogItem | null>(
        () => {
            const seriesId = this.selectedSeriesId();
            if (!Number.isFinite(seriesId) || seriesId <= 0) {
                return null;
            }

            return (
                (this.getSerialStreams().find((item) => {
                    const candidateId =
                        item.series_id ??
                        item.xtream_id ??
                        (item as { id?: string | number }).id;

                    return Number(candidateId) === seriesId;
                }) as XtreamSeriesCatalogItem | undefined) ?? null
            );
        }
    );
    readonly duplicateVariants = computed(
        () =>
            findXtreamSeriesDuplicateVariants(
                this.getSerialStreams(),
                this.selectedCatalogItem()
            ) as XtreamSeriesVariant[]
    );
    readonly hasDuplicateVariants = computed(
        () => this.duplicateVariants().length > 1
    );
    readonly selectedVariant = computed<XtreamSeriesVariant | null>(() => {
        const variants = this.duplicateVariants();
        const selectedKey = this.selectedVariantKey();

        return (
            variants.find(
                (variant) => getXtreamSeriesVariantKey(variant) === selectedKey
            ) ??
            variants[0] ??
            this.selectedCatalogItem()
        );
    });
    readonly selectedVariantNumericId = computed(
        () =>
            this.resolveSeriesNumericId(this.selectedVariant()) ??
            this.selectedSeriesId()
    );
    readonly imdbOverrideKey = computed(() => {
        const variant = this.selectedVariant();
        const stableKey =
            variant?.duplicateGroupKey ??
            variant?.imdb_id ??
            variant?.imdbId ??
            this.selectedVariantNumericId();
        const key = String(stableKey ?? '').trim();

        return key ? `series:${key}` : null;
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

        return this.formatImdbRating(this.selectedItem()?.info?.rating);
    });
    private imdbOverrideInputSignature = '';

    constructor() {
        effect(() => {
            const item = this.xtreamStore.selectedItem() as unknown as
                | (XtreamSerieDetails & {
                      readonly series_id?: string | number;
                  })
                | null;
            this.selectedItem.set(
                item
                    ? {
                          ...item,
                          series_id: Number(item.series_id),
                      }
                    : null
            );
            this.seriesEpisodeMediaMetadata.set(null);
        });

        effect(() => {
            const playlist = this.xtreamStore.currentPlaylist();
            this.currentPlaylistId.set(playlist?.id ?? '');
            this.xtreamDownloadContext.set(
                playlist
                    ? {
                          serverUrl: playlist.serverUrl,
                          username: playlist.username,
                          password: playlist.password,
                          userAgent: playlist.userAgent,
                          origin: playlist.origin,
                          referrer: playlist.referrer,
                      }
                    : null
            );
        });

        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const { categoryId, serialId } = this.route.snapshot.params;
            if (!playlistId || this.detailsInitDone()) {
                return;
            }

            this.initializeSerialDetails(playlistId, categoryId, serialId);
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
                    (variant) =>
                        getXtreamSeriesVariantKey(variant) === selectedKey
                )
            ) {
                this.selectedVariantKey.set(
                    getXtreamSeriesVariantKey(variants[0])
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
            const playlistId = this.currentPlaylistId();
            const selectedItem = this.selectedItem();
            const xtreamId = Number(selectedItem?.series_id ?? 0);
            const backdropUrl = selectedItem?.info?.backdrop_path?.[0]?.trim();

            if (
                !playlistId ||
                !Number.isFinite(xtreamId) ||
                xtreamId <= 0 ||
                !backdropUrl
            ) {
                return;
            }

            const backfillKey = `${playlistId}:${xtreamId}:${backdropUrl}`;
            if (this.backdropBackfillKey() === backfillKey) {
                return;
            }

            this.backdropBackfillKey.set(backfillKey);
            void this.xtreamStore.backfillContentBackdrop({
                xtreamId,
                contentType: 'series',
                playlist: this.xtreamStore.currentPlaylist,
                backdropUrl,
            });
        });

        effect(() => {
            const session = this.externalPlayback.activeSession();
            const selectedItem = this.selectedItem();
            const playlistId = this.currentPlaylistId();

            if (
                !session?.contentInfo ||
                !selectedItem?.series_id ||
                !playlistId ||
                session.contentInfo.contentType !== 'episode' ||
                session.contentInfo.playlistId !== playlistId ||
                session.contentInfo.seriesXtreamId !==
                    Number(selectedItem.series_id)
            ) {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(null);
                return;
            }

            if (session.status === 'launching') {
                this.openingEpisodeId.set(session.contentInfo.contentXtreamId);
                this.activeEpisodeId.set(null);
                return;
            }

            if (session.status === 'opened' || session.status === 'playing') {
                this.openingEpisodeId.set(null);
                this.activeEpisodeId.set(session.contentInfo.contentXtreamId);
                return;
            }

            this.openingEpisodeId.set(null);
            this.activeEpisodeId.set(null);
        });

        if (window.electron?.onPlaybackPositionUpdate) {
            this.unsubscribePositionUpdates =
                window.electron.onPlaybackPositionUpdate(
                    (data: PlaybackPositionData) => {
                        const selectedItem = this.selectedItem();

                        if (
                            data.contentType !== 'episode' ||
                            data.playlistId !== this.currentPlaylistId() ||
                            data.seriesXtreamId !==
                                Number(selectedItem?.series_id ?? 0)
                        ) {
                            return;
                        }

                        this.updateEpisodePlaybackPosition(data);
                    }
                );
        }
    }

    ngOnInit(): void {
        const currentPlaylist = this.xtreamStore.currentPlaylist();
        if (!currentPlaylist?.id) {
            return;
        }

        const { categoryId, serialId } = this.route.snapshot.params;
        this.initializeSerialDetails(currentPlaylist.id, categoryId, serialId);
        this.detailsInitDone.set(true);
    }

    ngOnDestroy(): void {
        this.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
        this.unsubscribePositionUpdates?.();
    }

    playEpisode(episode: XtreamSerieEpisode): void {
        this.addToRecentlyViewed(this.selectedVariantNumericId());

        const streamUrl = this.xtreamStore.constructEpisodeStreamUrl(episode);
        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: Number(episode.id),
            contentType: 'episode',
            seriesXtreamId: this.selectedVariantNumericId(),
            seasonNumber: Number(episode.season),
            episodeNumber: Number(episode.episode_num),
        };

        const position = this.episodePlaybackPositions().get(
            Number(episode.id)
        );

        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: episode.title,
            thumbnail: this.selectedItem().info.cover,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    playQuickStartEpisode(): void {
        const action = this.quickStartAction();
        if (!action || action.disabled) {
            return;
        }

        this.playEpisode(action.episode);
    }

    toggleFavorite(): void {
        this.xtreamStore.toggleFavorite(
            this.selectedVariantNumericId(),
            this.xtreamStore.currentPlaylist().id,
            'series',
            this.selectedItem()?.info?.backdrop_path?.[0]
        );
    }

    selectSeriesVariant(variant: XtreamSeriesVariant): void {
        this.selectedVariantKey.set(getXtreamSeriesVariantKey(variant));
        this.closeInlinePlayer();

        const playlistId =
            this.currentPlaylistId() ?? this.xtreamStore.currentPlaylist()?.id;
        const seriesId = this.resolveSeriesNumericId(variant);
        const categoryId = Number(
            variant.category_id ?? this.route.snapshot.params.categoryId
        );
        if (!playlistId || !Number.isFinite(seriesId) || seriesId <= 0) {
            return;
        }

        this.initializeSerialDetails(playlistId, categoryId, seriesId);
    }

    isSelectedVariant(variant: XtreamSeriesVariant): boolean {
        return getXtreamSeriesVariantKey(variant) === this.selectedVariantKey();
    }

    variantKey(variant: XtreamSeriesVariant): string {
        return getXtreamSeriesVariantKey(variant);
    }

    variantTitle(variant: XtreamSeriesVariant): string {
        return (
            variant.title ??
            variant.name ??
            variant.o_name ??
            `Serie ${getXtreamSeriesVariantKey(variant)}`
        );
    }

    variantQualityLabel(variant: XtreamSeriesVariant): string {
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
        this.updateEpisodePlaybackPosition(position);
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

    setSeriesEpisodeMediaMetadata(metadata: MediaStreamMetadata | null): void {
        this.seriesEpisodeMediaMetadata.set(metadata);
        this.xtreamStore.setContentMediaMetadata({
            contentType: 'series',
            xtreamId: this.selectedSeriesId(),
            metadata,
        });
    }

    private addToRecentlyViewed(xtreamId: number): void {
        this.xtreamStore.addRecentItem({
            xtreamId,
            contentType: 'series',
            playlist: this.xtreamStore.currentPlaylist,
            backdropUrl: this.selectedItem()?.info?.backdrop_path?.[0],
        });
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

    async handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        const playlistId = this.currentPlaylistId();
        if (!playlistId) {
            return;
        }

        if (request.nextPosition) {
            await this.playbackPositions.savePlaybackPosition(
                playlistId,
                request.nextPosition
            );
            this.updateEpisodePlaybackPosition(request.nextPosition);
            return;
        }

        await this.playbackPositions.clearPlaybackPosition(
            playlistId,
            request.contentXtreamId,
            'episode'
        );
        this.removeEpisodePlaybackPosition(request.contentXtreamId);
    }

    private async loadSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<void> {
        const positions =
            await this.playbackPositions.getSeriesPlaybackPositions(
                playlistId,
                seriesXtreamId
            );
        const positionsMap = new Map<number, PlaybackPositionData>();
        positions.forEach((position) => {
            positionsMap.set(position.contentXtreamId, position);
        });
        this.episodePlaybackPositions.set(positionsMap);
    }

    private updateEpisodePlaybackPosition(
        position: PlaybackPositionData
    ): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.set(position.contentXtreamId, position);
        this.episodePlaybackPositions.set(updated);
    }

    private removeEpisodePlaybackPosition(contentXtreamId: number): void {
        const updated = new Map(this.episodePlaybackPositions());
        updated.delete(contentXtreamId);
        this.episodePlaybackPositions.set(updated);
    }

    private initializeSerialDetails(
        playlistId: string,
        categoryId: string | number,
        serialId: string | number
    ): void {
        this.xtreamStore.fetchSerialDetailsWithMetadata({
            serialId: String(serialId),
            categoryId: Number(categoryId),
        });
        const serialXtreamId = Number(serialId);
        this.xtreamStore.checkFavoriteStatus(
            serialXtreamId,
            playlistId,
            'series'
        );
        void this.loadSeriesPlaybackPositions(playlistId, serialXtreamId);
    }

    private resolveSeriesNumericId(
        item: XtreamSeriesVariant | XtreamSeriesCatalogItem | null | undefined
    ): number | null {
        const candidateId =
            item?.series_id ?? item?.xtream_id ?? item?.id ?? null;
        const numericId = Number(candidateId);
        return Number.isFinite(numericId) && numericId > 0 ? numericId : null;
    }

    private getSerialStreams(): XtreamSerieItem[] {
        return (
            (
                this.xtreamStore as unknown as {
                    serialStreams?: () => XtreamSerieItem[];
                }
            ).serialStreams?.() ?? []
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
