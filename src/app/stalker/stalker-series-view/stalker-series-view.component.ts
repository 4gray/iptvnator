import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { TranslatePipe } from '@ngx-translate/core';
import { FavoritesButtonComponent } from '../favorites-button/favorites-button.component';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-stalker-series-view',
    templateUrl: './stalker-series-view.component.html',
    styleUrls: ['../../xtream/detail-view.scss'],
    imports: [FavoritesButtonComponent, MatButton, MatDivider, TranslatePipe],
})
export class StalkerSeriesViewComponent {
    readonly stalkerStore = inject(StalkerStore);

    readonly selectedItem = this.stalkerStore.selectedItem;
    readonly seasonsData = this.stalkerStore.getSerialSeasonsResource;

    playEpisodeClicked(episode: any, cmd: string) {
        const item = this.selectedItem();
        this.stalkerStore.createLinkToPlayVod(
            cmd,
            item.info.name,
            item.info.movie_image,
            episode
        );
    }

    addToFavorites(item: any) {
        this.stalkerStore.addToFavorites({
            ...item,
            title: item.info.name,
            cover: item.info.movie_image,
            series_id: item.id,
            added_at: new Date().toISOString(),
            category_id: 'series',
        });
    }

    removeFromFavorites(serialId: string) {
        this.stalkerStore.removeFromFavorites(serialId);
    }
}
