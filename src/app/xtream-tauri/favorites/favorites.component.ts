import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
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
    private router = inject(Router);
    private store = inject(Store);
    private xtreamStore = inject(XtreamStore);

    favorites$: Observable<FavoriteItem[]>;

    ngOnInit() {
        const playlistId = this.store.selectSignal(selectActivePlaylist)()._id;
        this.favorites$ = this.favoritesService.getFavorites(playlistId);
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
        this.xtreamStore.setSelectedContentType(type);
        if (type === 'live') {
            this.router.navigate(['/xtreams', item.playlist_id, 'live']);
        } else {
            this.router.navigate([
                '/xtreams',
                item.playlist_id,
                item.category_id,
                type,
                item.xtream_id,
            ]);
        }
    }
}
