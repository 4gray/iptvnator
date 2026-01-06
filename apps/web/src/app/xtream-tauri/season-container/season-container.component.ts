import { KeyValuePipe } from '@angular/common';
import { Component, EventEmitter, Output, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { XtreamSerieEpisode, XtreamSerieEpisodeInfo } from 'shared-interfaces';

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    imports: [KeyValuePipe, MatIcon, MatProgressSpinnerModule],
})
export class SeasonContainerComponent {
    readonly seasons = input.required<Record<string, XtreamSerieEpisode[]>>();
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
}
