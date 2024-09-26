import { NgFor, NgIf, NgOptimizedImage } from '@angular/common';
import { Component, Signal, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { TranslateModule } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../favorites-button/favorites-button.component';
import { StalkerSeason } from '../models';

function sortByNumericValue(array: StalkerSeason[]): StalkerSeason[] {
    if (!array) return [];
    const key = 'name';
    return array.sort((a, b) => {
        const numericA = extractNumericValue(a[key]);
        const numericB = extractNumericValue(b[key]);
        return numericA - numericB;
    });
}

function extractNumericValue(str: string) {
    const matches = str.match(/\d+/);
    if (matches) {
        return parseInt(matches[0], 10);
    }
    return 0;
}

@Component({
    selector: 'app-stalker-series-view',
    templateUrl: './stalker-series-view.component.html',
    styleUrls: ['../../xtream/detail-view.scss'],
    standalone: true,
    imports: [
        FavoritesButtonComponent,
        MatButtonModule,
        MatDividerModule,
        NgIf,
        NgFor,
        NgOptimizedImage,
        TranslateModule,
    ],
})
export class StalkerSeriesViewComponent {
    seasons: Signal<StalkerSeason[]> = input.required({
        transform: sortByNumericValue,
    });

    playEpisode = output<{ series: string; cmd: string }>();
}
