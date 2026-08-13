import {
    Component,
    OnDestroy,
    computed,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    getStalkerReturnByHistoryState,
    getStalkerReturnToState,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    createLogger,
    createInlinePlaybackPositionWriter,
} from '@iptvnator/portal/shared/util';
import {
    createPortalFavoritesResource,
    createRefreshTrigger,
    isStalkerSeriesFlag,
    isSelectedStalkerVodFavorite,
    normalizeStalkerEntityId,
    StalkerSelectedVodItem,
    toggleStalkerVodFavorite,
} from '@iptvnator/portal/stalker/data-access';
import {
    type PlaybackFallbackRequest,
    VodDetailsComponent,
} from '@iptvnator/ui/playback';
import {
    DownloadsService,
    PlaybackPositionRuntimeBridgeService,
    PlaylistsService,
} from '@iptvnator/services';
import {
    createStalkerVodItem,
    PlaybackPositionData,
    ResolvedPortalPlayback,
    StalkerVodDetails,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';

import { startStalkerVodDownload } from './stalker-vod-download';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

@Component({
    selector: 'app-stalker-catalog-detail',
    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
    templateUrl: './stalker-catalog-detail.component.html',
    styles: [
        `
            :host {
                display: block;
                height: 100%;
                width: 100%;
            }
        `,
    ],
})
export class StalkerCatalogDetailComponent implements OnDestroy {
    private readonly catalog = inject(StalkerCatalogFacadeService);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly playbackPositionBridge = inject(
        PlaybackPositionRuntimeBridgeService
    );
    private readonly router = inject(Router);
    private readonly location = inject(Location);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly playlistService = inject(PlaylistsService);
    private readonly downloadsService = inject(DownloadsService);
    private readonly logger = createLogger('StalkerCatalogDetail');
    private readonly favoritesRefresh = createRefreshTrigger();
    private playbackRequestId = 0;
    private currentPlaybackOwnerKey = '';

    readonly contentType = this.catalog.contentType;
    readonly selectedItem = computed<StalkerSelectedVodItem | null>(
        () =>
            (this.catalog.selectedItem() as StalkerSelectedVodItem | null) ??
            null
    );
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly providerOnly = input(false);
    readonly playbackSessionKey = computed(() => {
        const sourceId = this.catalog.playlist()?.id;
        const contentId = normalizeStalkerEntityId(this.selectedItem()?.id);
        return sourceId && contentId
            ? createPlaybackSessionKey({ kind: 'vod', sourceId, contentId })
            : '';
    });
    private readonly playbackOwnerKey = computed(() =>
        JSON.stringify([this.playbackSessionKey(), this.contentType()])
    );
    private readonly selectedVodPosition = signal<PlaybackPositionData | null>(
        null
    );
    private unsubscribePositionUpdates: (() => void) | null = null;

    readonly isSeriesDetail = computed(() => {
        const item = this.selectedItem();
        return Boolean(
            item &&
            (this.contentType() === 'series' ||
                isStalkerSeriesFlag(item.is_series))
        );
    });

    readonly vodDetailsItem = computed<VodDetailsItem | null>(() => {
        const item = this.selectedItem();
        if (!item || this.contentType() !== 'vod' || this.isSeriesDetail()) {
            return null;
        }

        return createStalkerVodItem(
            item as unknown as StalkerVodDetails,
            this.catalog.playlist()?.id ?? ''
        );
    });

    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.selectedVodPosition()?.positionSeconds ?? null
    );

    readonly portalFavorites = createPortalFavoritesResource(
        this.playlistService,
        () => this.catalog.playlist()?.id,
        () => this.favoritesRefresh.refreshVersion()
    );

    readonly isSelectedVodFavorite = computed<boolean>(() =>
        isSelectedStalkerVodFavorite(
            this.vodDetailsItem(),
            this.portalFavorites.value() ?? []
        )
    );

    constructor() {
        effect(() => {
            const item = this.selectedItem();
            const playlistId = this.catalog.playlist()?.id;

            if (
                !item ||
                !playlistId ||
                this.contentType() !== 'vod' ||
                this.isSeriesDetail()
            ) {
                this.selectedVodPosition.set(null);
                return;
            }

            void this.loadSelectedVodPosition(playlistId, Number(item.id));
        });

        effect(() => {
            const ownerKey = this.playbackOwnerKey();
            if (ownerKey === this.currentPlaybackOwnerKey) return;
            this.currentPlaybackOwnerKey = ownerKey;
            this.closeInlinePlayer();
        });

        this.unsubscribePositionUpdates =
            this.playbackPositionBridge.onPlaybackPositionUpdate(
                (data: PlaybackPositionData) => {
                    const currentItem = this.selectedItem();
                    if (
                        data.contentType !== 'vod' ||
                        data.playlistId !== this.catalog.playlist()?.id ||
                        data.contentXtreamId !== Number(currentItem?.id)
                    ) {
                        return;
                    }

                    this.selectedVodPosition.set(data);
                }
            ) ?? null;
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
                this.catalog.addToFavorites(item, onDone),
            removeFromFavorites: (favoriteId, onDone) =>
                this.catalog.removeFromFavorites(favoriteId, onDone),
            onComplete: () => {
                this.favoritesRefresh.refresh();
            },
        });
    }

    onVodBack(): void {
        const historyState = window.history.state;
        const returnTo = getStalkerReturnToState(historyState);
        const returnByHistory = getStalkerReturnByHistoryState(historyState);
        this.closeInlinePlayer();
        this.catalog.clearSelectedItem();

        // A collection handoff is exactly one entry back, and the collection's
        // tab/scope/inline-detail live only on that entry — re-navigating would
        // drop them and leave this page one browser Back away.
        if (returnByHistory) {
            this.location.back();
            return;
        }

        if (returnTo) {
            void this.router.navigateByUrl(returnTo);
        }
    }

    private readonly positionWriter = createInlinePlaybackPositionWriter({
        playback: this.inlinePlayback,
        save: (playlistId, position) =>
            void this.playbackPositions.savePlaybackPosition(
                playlistId,
                position
            ),
        onSaved: (position) => this.selectedVodPosition.set(position),
    });

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.positionWriter.handleTimeUpdate(event);
    }

    closeInlinePlayer(): void {
        this.playbackRequestId += 1;
        this.inlinePlayback.set(null);
        this.positionWriter.reset();
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
        const launch = this.portalPlayer.openExternalPlayback(
            request.playback,
            request.player
        );
        request.trackLaunch(launch);
        void launch;
    }

    async onVodDownload(item: VodDetailsItem): Promise<void> {
        await startStalkerVodDownload(item, {
            playlist: this.catalog.playlist(),
            downloadsService: this.downloadsService,
            fetchMovieFileId: (id) => this.catalog.fetchMovieFileId(id),
            fetchLinkToPlay: (portalUrl, macAddress, cmd, linkFlags) =>
                this.catalog.fetchLinkToPlay(
                    portalUrl,
                    macAddress,
                    cmd,
                    undefined,
                    linkFlags
                ),
            language:
                this.translateService.currentLang ||
                this.translateService.defaultLang ||
                'en',
        });
    }

    ngOnDestroy(): void {
        this.closeInlinePlayer();
        this.unsubscribePositionUpdates?.();
    }

    private async loadSelectedVodPosition(
        playlistId: string,
        vodId: number
    ): Promise<void> {
        if (Number.isNaN(vodId)) {
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

    private async startStalkerVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        const requestId = ++this.playbackRequestId;
        const sessionKey = this.playbackSessionKey();
        const ownerKey = this.playbackOwnerKey();
        const usesEmbeddedPlayer = this.portalPlayer.isEmbeddedPlayer();
        if (usesEmbeddedPlayer && !sessionKey) return;

        try {
            const playback = await this.catalog.resolveVodPlayback(
                cmd,
                title,
                thumbnail,
                startTime
            );
            if (
                requestId !== this.playbackRequestId ||
                this.playbackOwnerKey() !== ownerKey
            ) {
                return;
            }

            this.positionWriter.reset();
            if (usesEmbeddedPlayer) {
                this.inlinePlayback.set(playback);
                return;
            }

            this.closeInlinePlayer();
            void this.portalPlayer.openResolvedPlayback(playback, true);
        } catch (error) {
            if (
                requestId !== this.playbackRequestId ||
                this.playbackOwnerKey() !== ownerKey
            ) {
                return;
            }
            this.logger.error('Failed to start inline VOD playback', error);
            const errorMessage =
                error instanceof Error && error.message === 'nothing_to_play'
                    ? this.translateService.instant(
                          'PORTALS.CONTENT_NOT_AVAILABLE'
                      )
                    : this.translateService.instant('PORTALS.PLAYBACK_ERROR');
            this.snackBar.open(errorMessage, undefined, {
                duration: 3000,
            });
        }
    }
}
