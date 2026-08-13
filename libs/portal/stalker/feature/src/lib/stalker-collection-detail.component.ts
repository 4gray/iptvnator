import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    forwardRef,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    PortalDetailShellComponent,
    VIEW_IN_PORTAL_HANDOFF,
    ViewInPortalHandoff,
} from '@iptvnator/ui/components';
import {
    createLogger,
    getUnifiedCollectionDetailNavigation,
    PORTAL_EXTERNAL_PLAYBACK,
    PORTAL_PLAYBACK_POSITIONS,
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    buildStalkerSelectedVodItem,
    clearStalkerDetailViewState,
    createStalkerDetailViewState,
    createStalkerInlineDetailState,
    normalizeStalkerEntityId,
    StalkerSelectedVodItem,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import type { PlaybackFallbackRequest } from '@iptvnator/ui/playback';
import { PlaylistsService } from '@iptvnator/services';
import { Playlist, VodDetailsItem } from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { StalkerInlineDetailComponent } from './stalker-inline-detail/stalker-inline-detail.component';
import {
    resolveStalkerCollectionDetailMode,
    resolveStalkerCollectionItem,
    resolveStalkerCollectionSelectedCategory,
    StalkerDetailCategory,
} from './stalker-collection-detail-mode';
import { StalkerCollectionFavoritesController } from './stalker-collection-favorites.controller';
import { StalkerCollectionPlaybackController } from './stalker-collection-playback.controller';
import {
    captureStalkerCollectionStoreState,
    restoreStalkerCollectionStoreState,
} from './stalker-collection-store-snapshot';

@Component({
    selector: 'app-stalker-collection-detail',
    imports: [PortalDetailShellComponent, StalkerInlineDetailComponent],
    template: `
        @if (inlineDetail().categoryId) {
            <app-stalker-inline-detail
                [playbackSessionKey]="playbackSessionKey()"
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
            <app-portal-detail-shell [isLoading]="true" />
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: VIEW_IN_PORTAL_HANDOFF,
            useExisting: forwardRef(() => StalkerCollectionDetailComponent),
        },
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
})
export class StalkerCollectionDetailComponent implements ViewInPortalHandoff {
    readonly item = input<UnifiedCollectionItem | null>(null);
    readonly closeRequested = output<void>();

    private readonly playlistsService = inject(PlaylistsService);
    private readonly router = inject(Router);
    private readonly stalkerStore = inject(StalkerStore);
    readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly portalPlayer = inject(PORTAL_PLAYER);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly logger = createLogger('StalkerCollectionDetail');
    private readonly originalState = captureStalkerCollectionStoreState(
        this.stalkerStore
    );

    private readonly favorites = new StalkerCollectionFavoritesController({
        playlistsService: this.playlistsService,
        stalkerStore: this.stalkerStore,
        vodDetailsItem: () => this.vodDetailsItem(),
    });

    private readonly playback = new StalkerCollectionPlaybackController({
        item: () => this.item(),
        stalkerStore: this.stalkerStore,
        playbackPositions: this.playbackPositions,
        portalPlayer: this.portalPlayer,
        snackBar: this.snackBar,
        translateService: this.translateService,
        logger: this.logger,
    });

    readonly inlinePlayback = this.playback.inlinePlayback;
    readonly playbackSessionKey = this.playback.playbackSessionKey;
    readonly selectedVodPlaybackPosition =
        this.playback.selectedVodPlaybackPosition;
    readonly isSelectedVodFavorite = this.favorites.isFavorite;
    readonly portalFavorites = this.favorites.resource;

    readonly itemDetails = signal<StalkerSelectedVodItem | null>(null);
    readonly vodDetailsItem = signal<VodDetailsItem | null>(null);
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

    readonly viewInPortalAvailable = computed(() => {
        const item = this.item();
        return !!item && getUnifiedCollectionDetailNavigation(item) !== null;
    });
    readonly viewInPortalPlaylistName = computed(
        () => this.item()?.playlistName ?? null
    );

    private initRequestId = 0;
    private currentPlaybackOwnerKey = '';

    constructor() {
        effect(() => {
            this.portalFavorites.value();
            this.favorites.sync();
        });

        effect(() => {
            const item = this.item();
            const playbackOwnerKey = this.playbackSessionKey();
            untracked(() => {
                if (playbackOwnerKey !== this.currentPlaybackOwnerKey) {
                    this.currentPlaybackOwnerKey = playbackOwnerKey;
                    this.closeInlinePlayer();
                }
                void this.prepareDetail(item);
            });
        });

        // TMDB enrichment patches the STORE's selected item asynchronously;
        // this view renders local snapshots — pull the enriched copy back
        // in when it belongs to the currently shown item.
        effect(() => {
            const selected = this.stalkerStore.selectedItem();
            const current = this.itemDetails();
            if (!selected || !current || selected === current) {
                return;
            }
            const selectedId = normalizeStalkerEntityId(
                selected.id ?? selected.stream_id
            );
            if (
                !selectedId ||
                selectedId !== normalizeStalkerEntityId(current.id)
            ) {
                return;
            }

            const enriched = selected as StalkerSelectedVodItem;
            this.itemDetails.set(enriched);
            if (this.vodDetailsItem()) {
                const playlistId =
                    this.stalkerStore.currentPlaylist()?._id ?? '';
                this.vodDetailsItem.set(
                    createStalkerDetailViewState(enriched, playlistId)
                        .vodDetailsItem
                );
            }
        });
    }

    ngOnDestroy(): void {
        restoreStalkerCollectionStoreState(
            this.stalkerStore,
            this.originalState
        );
        this.closeInlinePlayer();
    }

    openInPortal(): void {
        const item = this.item();
        const navigation = item
            ? getUnifiedCollectionDetailNavigation(item, {
                  returnTo: this.router.url,
              })
            : null;
        if (navigation) {
            void this.router.navigate(navigation.link, {
                state: navigation.state,
            });
        }
    }

    onVodPlay(item: VodDetailsItem): void {
        this.playback.onVodPlay(item);
    }

    onVodResume(event: {
        item: VodDetailsItem;
        positionSeconds: number;
    }): void {
        this.playback.onVodResume(event);
    }

    onVodFavoriteToggled(event: {
        item: VodDetailsItem;
        isFavorite: boolean;
    }): void {
        this.favorites.toggle(event);
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.playback.handleInlineTimeUpdate(event);
    }

    closeInlinePlayer(): void {
        this.playback.closeInlinePlayer();
    }

    showCopyNotification(): void {
        this.playback.showCopyNotification();
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.playback.handleExternalFallbackRequest(request);
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

        const stalkerItem = resolveStalkerCollectionItem(item);
        const detailMode = resolveStalkerCollectionDetailMode(
            item,
            stalkerItem
        );
        const itemDetails = buildStalkerSelectedVodItem(
            stalkerItem as never,
            detailMode.needsSeriesFetch
        );

        this.detailCategoryOverride.set(detailMode.category);
        this.stalkerStore.setSelectedContentType(
            detailMode.selectedContentType
        );
        this.stalkerStore.setSelectedCategory(
            resolveStalkerCollectionSelectedCategory(
                item,
                stalkerItem,
                detailMode
            )
        );
        this.stalkerStore.setSelectedItem(itemDetails);
        this.itemDetails.set(itemDetails);

        if (detailMode.hasEmbeddedSeries) {
            // Embedded-series snapshots freeze the episode list at
            // favorite/recent time; re-fetch in the background so new
            // episodes appear. The store patch flows back into
            // itemDetails via the selected-item sync effect above.
            void this.stalkerStore.refreshEmbeddedSeriesSelection();
        }

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
            this.favorites.sync();
            void this.playback.loadSelectedVodPosition(
                playlist._id,
                Number(detailViewState.itemDetails?.id)
            );
            return;
        }

        const cleared = clearStalkerDetailViewState();
        this.vodDetailsItem.set(cleared.vodDetailsItem);
        this.favorites.reset();
        this.playback.clearSelectedVodPosition();
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

    private clearLocalDetailState(): void {
        const cleared = clearStalkerDetailViewState();
        this.itemDetails.set(cleared.itemDetails);
        this.vodDetailsItem.set(cleared.vodDetailsItem);
        this.detailCategoryOverride.set(null);
        this.favorites.reset();
        this.playback.clearSelectedVodPosition();
    }
}
