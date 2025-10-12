import {
    ChangeDetectionStrategy,
    Component,
    inject,
    OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { XtreamCategory } from 'shared-interfaces';
import { EpgViewComponent, WebPlayerViewComponent } from 'shared-portals';
import { SettingsStore } from '../../services/settings-store.service';
import { MpvPlayerBarComponent } from '../../shared/components/mpv-player-bar/mpv-player-bar.component';
import { CategoryViewComponent } from '../category-view/category-view.component';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss', '../sidebar.scss'],
    imports: [
        CategoryViewComponent,
        EpgViewComponent,
        FormsModule,
        MatFormFieldModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatListModule,
        MpvPlayerBarComponent,
        PortalChannelsListComponent,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent implements OnInit {
    private readonly favoritesService = inject(FavoritesService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;
    readonly epgItems = this.xtreamStore.epgItems;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    private readonly route = inject(ActivatedRoute);

    readonly player = this.settingsStore.player;
    streamUrl: string;
    favorites = new Map<number, boolean>();

    ngOnInit() {
        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    // Map using content.id instead of xtream_id
                    favorites.forEach((fav: any) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                });
        }

        const { categoryId } = this.route.firstChild.snapshot.params;
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));
    }

    playLive(item: any) {
        const streamUrl = this.xtreamStore.constructStreamUrl(item);
        this.streamUrl = streamUrl;
        this.xtreamStore.openPlayer(streamUrl, item.title, item.poster_url);
    }

    selectCategory(category: XtreamCategory) {
        const categoryId = (category as any).category_id ?? category.id;
        this.xtreamStore.setSelectedCategory(categoryId);
    }

    backToCategories() {
        this.xtreamStore.setSelectedCategory(null);
    }
}
