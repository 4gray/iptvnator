import { Location, SlicePipe } from '@angular/common';
import { Component, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
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
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import {
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
    XtreamSerieDetails,
} from 'shared-interfaces';

type XtreamSerieDetailsView = XtreamSerieDetails & {
    readonly series_id: number;
};

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../../../../../../ui/components/src/lib/styles/detail-view.scss'],
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

    readonly selectedItem = signal<XtreamSerieDetailsView | null>(null);
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    readonly episodePlaybackPositions = signal<
        Map<number, PlaybackPositionData>
    >(new Map());
    readonly currentPlaylistId = signal('');
    readonly xtreamDownloadContext =
        signal<SeasonContainerXtreamDownloadContext | null>(null);
    private readonly detailsInitDone = signal(false);
    private lastSaveTime = 0;
    private unsubscribePositionUpdates: (() => void) | null = null;
    readonly openingEpisodeId = signal<number | null>(null);
    readonly activeEpisodeId = signal<number | null>(null);

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
        this.addToRecentlyViewed(this.route.snapshot.params.serialId);

        const streamUrl = this.xtreamStore.constructEpisodeStreamUrl(episode);
        const contentInfo: PlayerContentInfo = {
            playlistId: this.xtreamStore.currentPlaylist().id,
            contentXtreamId: Number(episode.id),
            contentType: 'episode',
            seriesXtreamId: Number(this.selectedItem().series_id),
            seasonNumber: Number(episode.season),
            episodeNumber: Number(episode.episode_num),
        };

        const position = this.episodePlaybackPositions().get(Number(episode.id));

        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: episode.title,
            thumbnail: this.selectedItem().info.cover,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    toggleFavorite(): void {
        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.serialId,
            this.xtreamStore.currentPlaylist().id
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

    private addToRecentlyViewed(xtreamId: number): void {
        this.xtreamStore.addRecentItem({
            contentId: xtreamId,
            playlist: this.xtreamStore.currentPlaylist,
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
        const positions = await this.playbackPositions.getSeriesPlaybackPositions(
            playlistId,
            seriesXtreamId
        );
        const positionsMap = new Map<number, PlaybackPositionData>();
        positions.forEach((position) => {
            positionsMap.set(position.contentXtreamId, position);
        });
        this.episodePlaybackPositions.set(positionsMap);
    }

    private updateEpisodePlaybackPosition(position: PlaybackPositionData): void {
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
        serialId: string
    ): void {
        this.xtreamStore.fetchSerialDetailsWithMetadata({
            serialId,
            categoryId: Number(categoryId),
        });
        const serialXtreamId = Number(serialId);
        this.xtreamStore.checkFavoriteStatus(serialXtreamId, playlistId);
        void this.loadSeriesPlaybackPositions(playlistId, serialXtreamId);
    }
}
