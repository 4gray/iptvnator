import { JsonPipe, KeyValuePipe, NgFor, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { XtreamSerieEpisode } from '../../../../shared/xtream-serie-details.interface';

@Component({
    selector: 'app-season-container',
    templateUrl: './season-container.component.html',
    styleUrls: ['./season-container.component.scss'],
    standalone: true,
    imports: [JsonPipe, KeyValuePipe, NgFor, MatCardModule, NgIf],
})
export class SeasonContainerComponent {
    @Input({ required: true }) seasons: Record<string, XtreamSerieEpisode[]>;

    @Output() episodeClicked = new EventEmitter<any>();

    selectedSeason: string;

    selectSeason(seasonKey: string) {
        this.selectedSeason = seasonKey;
    }

    selectEpisode(episode: any) {
        this.episodeClicked.emit(episode);
    }
}
