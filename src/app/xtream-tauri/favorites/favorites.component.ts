import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { FilterByTypePipe } from '../../shared/pipes/filter-by-type.pipe';
import { selectActivePlaylist } from '../../state/selectors';
import { FavoriteItem } from '../services/favorite-item.interface';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-favorites',
    standalone: true,
    imports: [
        AsyncPipe,
        DatePipe,
        FilterByTypePipe,
        MatCardModule,
        MatIcon,
        MatIconButton,
        MatTabsModule,
        NgTemplateOutlet,
        TranslateModule,
    ],
    templateUrl: './favorites.component.html',
    styleUrl: './favorites.component.scss',
})
export class FavoritesComponent implements OnInit {
    private favoritesService = inject(FavoritesService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private store = inject(Store);
    private xtreamStore = inject(XtreamStore);

    favorites$: Observable<FavoriteItem[]>;
    liveCount = 0;
    moviesCount = 0;
    seriesCount = 0;

    ngOnInit() {
        const playlistId = this.store.selectSignal(selectActivePlaylist)()._id;
        this.favorites$ = this.favoritesService.getFavorites(playlistId);

        // Subscribe to update counts
        this.favorites$.subscribe((items) => {
            this.liveCount = items.filter(
                (item) => item.type === 'live'
            ).length;
            this.moviesCount = items.filter(
                (item) => (item as any).type === 'movie'
            ).length;
            this.seriesCount = items.filter(
                (item) => item.type === 'series'
            ).length;
        });
    }

    async removeFromFavorites(item: any) {
        await this.favoritesService.removeFromFavorites(
            item.id,
            item.playlist_id
        );
        // Refresh favorites after removal
        const playlistId = this.store.selectSignal(selectActivePlaylist)()._id;
        this.favorites$ = this.favoritesService.getFavorites(playlistId);
    }

    openItem(item: any) {
        const type = item.type === 'movie' ? 'vod' : item.type;
        this.xtreamStore.setSelectedContentType(type);
        if (type === 'live') {
            this.router.navigate(['..', type, item.category_id], {
                relativeTo: this.route,
            });
        } else {
            this.router.navigate(
                ['..', type, item.category_id, item.xtream_id],
                {
                    relativeTo: this.route,
                }
            );
        }
    }
}
