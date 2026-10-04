import {
    Component,
    OnDestroy,
    computed,
    effect,
    inject,
    input,
    signal,
    ChangeDetectionStrategy,
} from '@angular/core';
import { Location } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    consumeStalkerReturnMarker,
    createInlinePlaybackPositionWriter,
    createLogger,
    createPendingPlaybackStart,
    resolveStalkerBackNavigation,
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
import { VodDetailsComponent } from '@iptvnator/ui/playback';
import {
    DownloadsService,
    PlaybackPositionRuntimeBridgeService,
    PlaylistsService,
} from '@iptvnator/services';
import {
    ResolvedPortalPlayback,
    StalkerVodDetails,
    VodDetailsItem,
    createStalkerVodItem,
} from '@iptvnator/shared/interfaces';
import { StalkerCatalogFacadeService } from '../stalker-catalog-facade.service';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';

import { startStalkerCatalogVodPlayback } from './stalker-catalog-vod-playback';
import { StalkerCatalogVodPosition } from './stalker-catalog-vod-position';
import { startStalkerVodDownload } from './stalker-vod-download';
import { createStalkerVodWatchedToggle } from '../stalker-vod-watched-toggle';
import {
    createStalkerVodDetailActions,
    beginTrackedExternalLaunch,
} from '../stalker-vod-detail-actions';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

@Component({
    selector: 'app-stalker-catalog-detail',
    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
    templateUrl: './stalker-catalog-detail.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
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
    playbackRequestId = 0;
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
    readonly playbackOwnerKey = computed(() =>
        JSON.stringify([this.playbackSessionKey(), this.contentType()])
    );
    private readonly vodPosition = new StalkerCatalogVodPosition({
        playbackPositions: this.playbackPositions,
        playbackPositionBridge: this.playbackPositionBridge,
        playlistId: () => this.catalog.playlist()?.id,
        selectedItem: this.selectedItem,
        contentType: this.contentType,
        isSeriesDetail: () => this.isSeriesDetail(),
    });
    /** The stored row is in hand (not the placeholder shown while reading). */
    readonly positionLoaded = this.vodPosition.loaded;
    /**
     * The start still waiting on the portal between the click and playback,
     * keyed by its owner: a stale resolution for the previous movie must not
     * hold the next movie's toggle hostage.
     */
    readonly pendingStart = createPendingPlaybackStart<string>();
    readonly playbackStartPending = computed(() =>
        this.pendingStart.isPendingFor(this.playbackOwnerKey())
    );

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

    readonly selectedVodPlaybackDuration = computed<number | null>(
        () => this.vodPosition.position()?.durationSeconds ?? null
    );
    readonly sourceLabel = computed(
        () => this.catalog.playlist()?.title ?? null
    );
    readonly selectedVodPlaybackPosition = computed<number | null>(
        () => this.vodPosition.position()?.positionSeconds ?? null
    );

    /** Manual watched toggle; the child gates it on live playback itself. */
    readonly watchedToggle = createStalkerVodWatchedToggle({
        owner: () => {
            const playlistId = this.catalog.playlist()?.id;
            const vodId = Number(this.selectedItem()?.id);
            return playlistId && Number.isFinite(vodId)
                ? { playlistId, vodId }
                : null;
        },
        playbackPositions: this.playbackPositions,
        position: this.vodPosition.position,
        playingNow: computed(
            () => this.inlinePlayback() !== null || this.playbackStartPending()
        ),
        positionReady: this.positionLoaded,
        applyPosition: (position) => {
            // A read still in flight started from the pre-write row; letting
            // it land would revert the toggle it never saw.
            this.vodPosition.discardPendingLoad();
            this.vodPosition.position.set(position);
        },
        snackBar: this.snackBar,
        translateService: this.translateService,
        logger: this.logger,
        onPersisted: (playlistId) => this.catalog.refreshPositions(playlistId),
    });

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
        this.vodPosition.connect();

        effect(() => {
            const ownerKey = this.playbackOwnerKey();
            if (ownerKey === this.currentPlaybackOwnerKey) return;
            // A start the left movie still resolves no longer applies; a
            // return to it must not find Play held by a hung request.
            this.pendingStart.retire(this.currentPlaybackOwnerKey);
            this.currentPlaybackOwnerKey = ownerKey;
            this.closeInlinePlayer();
        });
    }

    onVodPlay(item: VodDetailsItem, positionSeconds?: number): void {
        if (item.type === 'stalker') {
            void this.startStalkerVodPlayback(
                item.cmd,
                item.data.info?.name,
                item.data.info?.movie_image,
                positionSeconds
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

    onVodWatchedToggled(event: { item: VodDetailsItem }): void {
        void this.watchedToggle.toggleItem(event.item);
    }

    readonly vodDetailActions = createStalkerVodDetailActions({
        resolvePlayback: (cmd, title, thumbnail, startTime) =>
            this.catalog.resolveVodPlayback(cmd, title, thumbnail, startTime),
        portalPlayer: this.portalPlayer,
        externalPlayback: this.externalPlayback,
        playbackPositions: this.playbackPositions,
        playlistId: () => this.catalog.playlist()?.id,
        selectedVodId: () =>
            this.contentType() === 'vod' && !this.isSeriesDetail()
                ? Number(this.selectedItem()?.id) || null
                : null,
        selectedVodPosition: this.vodPosition.position,
        discardPendingPositionLoad: () => this.vodPosition.discardPendingLoad(),
        beforeExternalLaunch: () => this.closeInlinePlayer(),
        beginPendingStart: () => beginTrackedExternalLaunch(this),
        afterProgressReset: (playlistId) =>
            void this.catalog.refreshPositions(playlistId),
        download: (item) =>
            startStalkerVodDownload(item, {
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
            }),
        snackBar: this.snackBar,
        translate: this.translateService,
        logError: (message, error) => this.logger.error(message, error),
    });

    onVodBack(): void {
        const back = resolveStalkerBackNavigation(
            window.history.state,
            this.selectedItem()
        );
        // Closing the detail is unconditional: a `none` decision (no return
        // target, or a marker left by an earlier handoff) still returns the
        // user to the category list — it only suppresses the navigation.
        this.closeInlinePlayer();
        this.catalog.clearSelectedItem();

        if (back.kind === 'history-back') {
            // One-shot: retire the contract so a browser Forward onto this
            // entry cannot replay it for a freshly opened title.
            consumeStalkerReturnMarker();
            this.location.back();
        } else if (back.kind === 'navigate') {
            void this.router.navigateByUrl(back.url);
        }
    }

    private readonly positionWriter = createInlinePlaybackPositionWriter({
        playback: this.inlinePlayback,
        save: (playlistId, position) =>
            void this.playbackPositions.savePlaybackPosition(
                playlistId,
                position
            ),
        onSaved: (position) => this.vodPosition.position.set(position),
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

    ngOnDestroy(): void {
        this.closeInlinePlayer();
        this.vodPosition.disconnect();
    }

    private async startStalkerVodPlayback(
        cmd?: string,
        title?: string,
        thumbnail?: string,
        startTime?: number
    ): Promise<void> {
        await startStalkerCatalogVodPlayback(this, {
            resolvePlayback: () =>
                this.catalog.resolveVodPlayback(
                    cmd,
                    title,
                    thumbnail,
                    startTime
                ),
            portalPlayer: this.portalPlayer,
            resetPositionWriter: () => this.positionWriter.reset(),
            logger: this.logger,
            translate: this.translateService,
            snackBar: this.snackBar,
        });
    }
}
