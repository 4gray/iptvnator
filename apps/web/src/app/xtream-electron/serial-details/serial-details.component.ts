import { Location, SlicePipe } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ContentHeroComponent } from 'components';
import {
    PlayerContentInfo,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from 'shared-interfaces';
import { PlayerService } from '../../services/player.service';
import { PortalInlinePlayerComponent } from '../../shared/components/portal-inline-player/portal-inline-player.component';
import { SeasonContainerComponent } from '../season-container/season-container.component';
import { XtreamStore } from '../stores/xtream.store';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../detail-view.scss'],
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
    private readonly playerService = inject(PlayerService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);

    readonly selectedItem = this.xtreamStore.selectedItem;
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly inlinePlayback = signal<ResolvedPortalPlayback | null>(null);
    private lastSaveTime = 0;

    ngOnInit(): void {
        const { categoryId, serialId } = this.route.snapshot.params;
        this.xtreamStore.fetchSerialDetailsWithMetadata({
            serialId,
            categoryId,
        });
        this.xtreamStore.checkFavoriteStatus(
            serialId,
            this.xtreamStore.currentPlaylist().id
        );
        this.xtreamStore.loadSeriesPositions(
            this.xtreamStore.currentPlaylist().id,
            Number(serialId)
        );
    }

    ngOnDestroy(): void {
        this.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
    }

    playEpisode(episode: XtreamSerieEpisode) {
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

        const position = this.xtreamStore
            .playbackPositions()
            .get(`episode_${episode.id}`);

        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: episode.title,
            thumbnail: this.selectedItem().info.cover,
            startTime: position?.positionSeconds,
            contentInfo,
        };

        this.startPlayback(playback);
    }

    private addToRecentlyViewed(xtreamId: number) {
        this.xtreamStore.addRecentItem({
            contentId: xtreamId,
            playlist: this.xtreamStore.currentPlaylist,
        });
    }

    toggleFavorite() {
        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.serialId,
            this.xtreamStore.currentPlaylist().id
        );
    }

    goBack() {
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
        void this.xtreamStore.savePosition(playback.contentInfo.playlistId, {
            ...playback.contentInfo,
            positionSeconds: Math.floor(event.currentTime),
            durationSeconds: Math.floor(event.duration),
        });
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

    private startPlayback(playback: ResolvedPortalPlayback): void {
        this.lastSaveTime = 0;
        if (this.playerService.isEmbeddedPlayer()) {
            this.inlinePlayback.set(playback);
            return;
        }

        this.closeInlinePlayer();
        this.playerService.openResolvedPlayback(playback, true);
    }
}
