import { KeyValuePipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { XtreamSerieEpisode, XtreamSerieEpisodeInfo } from 'shared-interfaces';

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    imports: [KeyValuePipe, MatIcon],
})
export class SeasonContainerComponent {
    @Input({ required: true }) seasons: Record<string, XtreamSerieEpisode[]>;

    @Output() episodeClicked = new EventEmitter<any>();

    selectedSeason: string;

    compareSeasons(a: any, b: any): number {
        return Number(a.key) - Number(b.key);
    }

    selectSeason(seasonKey: string) {
        this.selectedSeason = seasonKey;
    }

    selectEpisode(episode: any) {
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
