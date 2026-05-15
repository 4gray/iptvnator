import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { ContentHeroComponent } from '@iptvnator/ui/components';
import {
    buildStalkerStateItem,
    createLogger,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    toStalkerCategoryId,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    buildStalkerSelectedVodItem,
    clearStalkerDetailViewState,
    createPortalFavoritesResource,
    createRefreshTrigger,
    createStalkerDetailViewState,
    createStalkerInlineDetailState,
    isSelectedStalkerVodFavorite,
    isStalkerSeriesFlag,
    StalkerContentType,
    StalkerSelectedVodItem,
    StalkerStore,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { PlaylistsService } from '@iptvnator/services';
import {
    PlaybackPositionData,
    Playlist,
    ResolvedPortalPlayback,
    StalkerPortalItem,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { StalkerInlineDetailComponent } from './stalker-inline-detail/stalker-inline-detail.component';
import { StalkerVodPlaybackController } from './stalker-vod-playback-controller';

interface StalkerCollectionStateSnapshot {
    currentPlaylist: Playlist | undefined;
    selectedContentType: StalkerContentType;
    selectedCategoryId: string | null | undefined;
    selectedItem: unknown;
}

type StalkerDetailCategory = 'vod' | 'series';

interface StalkerCollectionDetailMode {
    category: StalkerDetailCategory;
    selectedContentType: StalkerDetailCategory;
    hasEmbeddedSeries: boolean;
    needsSeriesFetch: boolean;
}

@Component({
    selector: 'app-stalker-collection-detail',
    imports: [ContentHeroComponent, StalkerInlineDetailComponent],
    template: `
        @if (inlineDetail().categoryId) {
            <app-stalker-inline-detail
                [categoryId]="inlineDetail().categoryId"
                [seriesItem]="inlineDetail().seriesItem"
                [isSeries]="inlineDetail().isSeries"
                [vodDetailsItem]="inlineDetail().vodDetailsItem"
                [isFavorite]="isSelectedVodFavorite()"
                [playbackPosition]="selectedVodPlaybackPosition()"
                [inlinePlayback]="inlinePlayback()"
                [externalPlayback]="externalPlayback.activeSession()"
                (backClicked)="closeRequested.emit()"
                (playClicked)="onVodPlay($event)"
                (resumeClicked)="onVodResume($event)"
                (favoriteToggled)="onVodFavoriteToggled($event)"
                (inlineTimeUpdated)="handleInlineTimeUpdate($event)"
                (inlinePlaybackClosed)="closeInlinePlayer()"
                (streamUrlCopied)="showCopyNotification()"
                (inlineExternalFallbackRequested)="
                    handleExternalFallbackRequest($event)
                "
            />
        } @else {
            <app-content-hero [isLoading]="true" />
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
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
})
export class StalkerCollectionDetailComponent {
    readonly item = input<UnifiedCollectionItem | null>(null);
    readonly closeRequested = output<void>();

    private readonly playlistsService = inject(PlaylistsService);
    private readonly stalkerStore = inject(StalkerStore);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly logger = createLogger('StalkerCollectionDetail');
    private readonly originalState = this.captureStoreState();
    private readonly favoritesRefresh = createRefreshTrigger();

    readonly itemDetails = signal<StalkerSelectedVodItem | null>(null);
    readonly vodDetailsItem = signal<VodDetailsItem | null>(null);
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    private readonly selectedVodPosition = signal<PlaybackPositionData | null>(
        null
    );
    readonly isSelectedVodFavorite = signal(false);
    readonly detailCategoryOverride = signal<StalkerDetailCategory | null>(
        null
    );
    readonly inlineDetail = computed(() =>
        createStalkerInlineDetailState(
            this.itemDetails(),
            this.vodDetailsItem(),
            this.detailCategoryOverride()
        )
    );

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistsService,
        () => this.stalkerStore.currentPlaylist()?._id,
        () => this.favoritesRefresh.refreshVersion()
    );
    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.selectedVodPosition()?.positionSeconds ?? null
    );

    private initRequestId = 0;
    private readonly vodPlayback = new StalkerVodPlaybackController({
        inlinePlayback: this.inlinePlayback,
        selectedVodPosition: this.selectedVodPosition,
        playbackPositions: this.playbackPositions,
        portalPlayer: this.portalPlayer,
        snackBar: this.snackBar,
        translateService: this.translateService,
        logger: this.logger,
        playbackErrorLogMessage: 'Failed to start collection VOD playback',
    });

    constructor() {
        effect(() => {
            this.portalFavorites.value();
            this.syncSelectedVodFavorite();
        });

        effect(() => {
            const item = this.item();
            untracked(() => {
                void this.prepareDetail(item);
            });
        });
    }

    ngOnDestroy(): void {
        void this.stalkerStore.setCurrentPlaylist(
            this.originalState.currentPlaylist
        );
        this.stalkerStore.setSelectedContentType(
            this.originalState.selectedContentType
        );
        this.stalkerStore.setSelectedCategory(
            this.originalState.selectedCategoryId
        );
        this.stalkerStore.setSelectedItem(
            this.originalState.selectedItem as never
        );
        this.closeInlinePlayer();
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
            addToFavorites: (item, onDone) =>
                this.stalkerStore.addToFavorites(
                    item as StalkerPortalItem,
                    onDone
                ),
            removeFromFavorites: (favoriteId, onDone) =>
                this.stalkerStore.removeFromFavorites(favoriteId, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
                this.syncSelectedVodFavorite();
            },
        });
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.vodPlayback.handleInlineTimeUpdate(event);
    }

    closeInlinePlayer(): void {
        this.vodPlayback.closeInlinePlayer();
    }

    showCopyNotification(): void {
        this.vodPlayback.showCopyNotification();
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.vodPlayback.handleExternalFallbackRequest(request);
    }

    private async prepareDetail(
        item: UnifiedCollectionItem | null
    ): Promise<void> {
        const requestId = ++this.initRequestId;

        if (!item) {
            this.clearLocalDetailState();
            this.closeInlinePlayer();
            return;
        }

        const playlist = await this.loadPlaylist(item.playlistId);
        if (requestId !== this.initRequestId) {
            return;
        }

        if (!playlist?.macAddress || !playlist.portalUrl) {
            this.clearLocalDetailState();
            return;
        }

        await this.stalkerStore.setCurrentPlaylist(playlist);
        if (requestId !== this.initRequestId) {
            return;
        }

        const stalkerItem = this.resolveStalkerItem(item);
        const detailMode = this.resolveDetailMode(item, stalkerItem);
        const itemDetails = buildStalkerSelectedVodItem(
            stalkerItem as never,
            detailMode.needsSeriesFetch
        );

        this.detailCategoryOverride.set(detailMode.category);
        this.stalkerStore.setSelectedContentType(
            detailMode.selectedContentType
        );
        this.stalkerStore.setSelectedCategory(
            this.resolveSelectedCategory(item, stalkerItem, detailMode)
        );
        this.stalkerStore.setSelectedItem(itemDetails);
        this.itemDetails.set(itemDetails);

        if (
            detailMode.selectedContentType === 'vod' &&
            !detailMode.hasEmbeddedSeries &&
            !detailMode.needsSeriesFetch
        ) {
            const detailViewState = createStalkerDetailViewState(
                itemDetails,
                playlist._id
            );
            this.itemDetails.set(detailViewState.itemDetails);
            this.vodDetailsItem.set(detailViewState.vodDetailsItem);
            this.syncSelectedVodFavorite();
            void this.loadSelectedVodPosition(
                playlist._id,
                Number(detailViewState.itemDetails?.id)
            );
            return;
        }

        const cleared = clearStalkerDetailViewState();
        this.vodDetailsItem.set(cleared.vodDetailsItem);
        this.isSelectedVodFavorite.set(false);
        this.selectedVodPosition.set(null);
    }

    private captureStoreState(): StalkerCollectionStateSnapshot {
        return {
            currentPlaylist:
                (this.stalkerStore.currentPlaylist() as Playlist | undefined) ??
                undefined,
            selectedContentType: this.stalkerStore.selectedContentType(),
            selectedCategoryId: this.stalkerStore.selectedCategoryId(),
            selectedItem: this.stalkerStore.selectedItem(),
        };
    }

    private async loadPlaylist(playlistId: string): Promise<Playlist | null> {
        try {
            return (
                (await firstValueFrom(
                    this.playlistsService.getPlaylistById(playlistId)
                )) ?? null
            );
        } catch {
            return null;
        }
    }

    private resolveStalkerItem(item: UnifiedCollectionItem): StalkerPortalItem {
        return buildStalkerStateItem(
            item.stalkerItem as StalkerPortalItem | undefined,
            {
                id:
                    item.stalkerId ??
                    item.uid.split('::')[item.uid.split('::').length - 1] ??
                    item.uid,
                title: item.name,
                type: item.contentType,
                category_id: item.categoryId,
                poster_url: item.posterUrl ?? item.logo ?? undefined,
            }
        ) as StalkerPortalItem;
    }

    private resolveDetailMode(
        item: UnifiedCollectionItem,
        stalkerItem: StalkerPortalItem
    ): StalkerCollectionDetailMode {
        const series = (stalkerItem as { series?: unknown[] }).series;
        const hasEmbeddedSeries = Array.isArray(series) && series.length > 0;
        const isVodSeries = isStalkerSeriesFlag(
            (stalkerItem as { is_series?: unknown }).is_series
        );
        const isRegularSeries =
            item.contentType === 'series' && !hasEmbeddedSeries && !isVodSeries;
        const selectedContentType: StalkerDetailCategory = isRegularSeries
            ? 'series'
            : 'vod';

        return {
            category: selectedContentType,
            selectedContentType,
            hasEmbeddedSeries,
            needsSeriesFetch:
                selectedContentType === 'vod' &&
                !hasEmbeddedSeries &&
                isVodSeries,
        };
    }

    private resolveSelectedCategory(
        item: UnifiedCollectionItem,
        stalkerItem: StalkerPortalItem,
        detailMode: StalkerCollectionDetailMode
    ): string | number {
        const categoryId =
            item.categoryId ??
            (stalkerItem as { category_id?: string | number }).category_id;

        if (
            detailMode.selectedContentType === 'vod' &&
            String(categoryId ?? '').toLowerCase() === 'series'
        ) {
            return 'vod';
        }

        return (
            categoryId ?? toStalkerCategoryId(detailMode.selectedContentType)
        );
    }

    private syncSelectedVodFavorite(): void {
        this.isSelectedVodFavorite.set(
            isSelectedStalkerVodFavorite(
                this.vodDetailsItem(),
                this.portalFavorites.value() ?? []
            )
        );
    }

    private clearLocalDetailState(): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails.set(cleared.itemDetails);
        this.vodDetailsItem.set(cleared.vodDetailsItem);
        this.detailCategoryOverride.set(null);
        this.isSelectedVodFavorite.set(false);
        this.selectedVodPosition.set(null);
    }

    private async startStalkerVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        await this.vodPlayback.startVodPlayback(() =>
            startTime === undefined
                ? this.stalkerStore.resolveVodPlayback(cmd, title, thumbnail)
                : this.stalkerStore.resolveVodPlayback(
                      cmd,
                      title,
                      thumbnail,
                      undefined,
                      undefined,
                      startTime
                  )
        );
    }

    private async loadSelectedVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        await this.vodPlayback.loadSelectedVodPosition(playlistId, vodId);
    }
}
