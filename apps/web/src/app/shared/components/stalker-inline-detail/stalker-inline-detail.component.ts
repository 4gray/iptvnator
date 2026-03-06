import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { VodDetailsItem } from 'shared-interfaces';
import { VodDetailsComponent } from '../../../xtream-electron/vod-details/vod-details.component';
import { StalkerSelectedVodItem } from '../../../stalker/models/stalker-favorite-item.interface';
import { StalkerSeriesViewComponent } from '../../../stalker/stalker-series-view/stalker-series-view.component';

@Component({
    selector: 'app-stalker-inline-detail',
    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
    templateUrl: './stalker-inline-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
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
export class StalkerInlineDetailComponent {
    readonly categoryId = input<'vod' | 'series' | null>(null);
    readonly seriesItem = input<StalkerSelectedVodItem | null>(null);
    readonly isSeries = input<boolean>(false);
    readonly vodDetailsItem = input<VodDetailsItem | null>(null);
    readonly isFavorite = input<boolean>(false);

    readonly backClicked = output<void>();
    readonly playClicked = output<VodDetailsItem>();
    readonly favoriteToggled = output<{
        item: VodDetailsItem;
        isFavorite: boolean;
    }>();

    onBackClicked() {
        this.backClicked.emit();
    }

    onPlayClicked(item: VodDetailsItem) {
        this.playClicked.emit(item);
    }

    onFavoriteToggled(event: { item: VodDetailsItem; isFavorite: boolean }) {
        this.favoriteToggled.emit(event);
    }
}
