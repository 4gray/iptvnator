import { KeyValuePipe } from '@angular/common';
import { Component, EventEmitter, Output, input, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode, XtreamSerieEpisodeInfo } from 'shared-interfaces';
import { XtreamStore } from '../stores/xtream.store';
import { ProgressCapsuleComponent } from '../shared/progress-capsule/progress-capsule.component';
import { WatchedBadgeComponent } from '../shared/watched-badge/watched-badge.component';

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    imports: [
        KeyValuePipe,
        MatButtonModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltipModule,
        ProgressCapsuleComponent,
        TranslateModule,
        WatchedBadgeComponent,
    ],
})
export class SeasonContainerComponent {
    private readonly xtreamStore = inject(XtreamStore);

    readonly seasons = input.required<Record<string, XtreamSerieEpisode[]>>();
    readonly seriesId = input.required<number>(); // Add seriesId input
    readonly isLoading = input<boolean>(false);

    @Output() episodeClicked = new EventEmitter<any>();
    @Output() seasonSelected = new EventEmitter<string>();

    selectedSeason: string;

    compareSeasons(a: any, b: any): number {
        return Number(a.key) - Number(b.key);
    }

    selectSeason(seasonKey: string) {
        this.selectedSeason = seasonKey;
        this.seasonSelected.emit(seasonKey);
    }

    selectEpisode(episode: XtreamSerieEpisode) {
        this.episodeClicked.emit(episode);
    }

    toggleWatched(event: Event, episode: XtreamSerieEpisode) {
        event.stopPropagation();
        const playlistId = this.xtreamStore.currentPlaylist().id;
        this.xtreamStore.toggleEpisodeWatched(
            playlistId,
            episode,
            this.seriesId()
        );
    }

    /**
     * Safely get episode info - returns undefined if info is an empty array
     * (Xtream API returns [] when no metadata available instead of null/object)
     */
    getEpisodeInfo(
        episode: XtreamSerieEpisode
    ): XtreamSerieEpisodeInfo | undefined {
        if (Array.isArray(episode.info) || !episode.info) {
            return undefined;
        }
        return episode.info;
    }

    isEpisodeWatched(episode: XtreamSerieEpisode) {
        return this.xtreamStore.isWatched(Number(episode.id), 'episode');
    }

    isEpisodeInProgress(episode: XtreamSerieEpisode) {
        return this.xtreamStore.isInProgress(Number(episode.id), 'episode');
    }

    getEpisodeProgress(episode: XtreamSerieEpisode) {
        return this.xtreamStore.getProgressPercent(
            Number(episode.id),
            'episode'
        );
    }

    getEpisodePositionText(episode: XtreamSerieEpisode): string | null {
        if (this.isEpisodeWatched(episode)) return null;

        const position = this.xtreamStore
            .playbackPositions()
            .get(`episode_${episode.id}`);
        if (!position || !position.positionSeconds) return null;

        let seconds = position.positionSeconds;
        let suffix = '';

        // Calculate remaining time if duration is available
        if (position.durationSeconds > 0) {
            const remaining = Math.max(
                0,
                position.durationSeconds - position.positionSeconds
            );

            if (remaining <= 0) return null;

            seconds = remaining;
            suffix = ' left';
        }

        const date = new Date(0);
        date.setSeconds(seconds);
        const timeString = date.toISOString().substr(11, 8);
        const formatted = timeString.startsWith('00:')
            ? timeString.substr(3)
            : timeString;
        return `${formatted}${suffix}`;
    }

    getSeasonWatchedCount(seasonKey: string): number {
        const episodes = this.seasons()[seasonKey];
        if (!episodes) return 0;
        return episodes.filter((e) => this.isEpisodeWatched(e)).length;
    }

    getSeasonProgressDash(seasonKey: string): string {
        const episodes = this.seasons()[seasonKey];
        if (!episodes || episodes.length === 0) return '0, 100';

        const watched = this.getSeasonWatchedCount(seasonKey);
        const percent = (watched / episodes.length) * 100;
        return `${percent}, 100`;
    }
}
