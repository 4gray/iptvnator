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
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { EpgViewComponent } from '../../portals/epg-view/epg-view.component';
import { WebPlayerViewComponent } from '../../portals/web-player-view/web-player-view.component';
import { PlayerService } from '../../services/player.service';
import { SettingsStore } from '../../services/settings-store.service';
import { CategoryViewComponent } from '../category-view/category-view.component';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

@Component({
    standalone: true,
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
        PortalChannelsListComponent,
        TranslateModule,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent implements OnInit {
    private favoritesService = inject(FavoritesService);
    private playerService = inject(PlayerService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly settingsStore = inject(SettingsStore);
    readonly epgItems = this.xtreamStore.epgItems;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    private readonly hideExternalInfoDialog =
        this.xtreamStore.hideExternalInfoDialog;
    private readonly selectedContentType = this.xtreamStore.selectedContentType;
    private readonly route = inject(ActivatedRoute);

    player = this.settingsStore.player;
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
        const { serverUrl, username, password } =
            this.xtreamStore.currentPlaylist();
        const streamUrl = `${serverUrl}/live/${username}/${password}/${item.xtream_id}.m3u8`;
        // TODO: offer option to select TS or m3u8
        this.openPlayer(streamUrl, item.title, item.poster_url);
        this.xtreamStore.setSelectedItem(item);
        this.xtreamStore.loadEpg();
    }

    openPlayer(streamUrl: string, title: string, thumbnail: string) {
        this.streamUrl = streamUrl;
        this.playerService.openPlayer(
            streamUrl,
            title,
            thumbnail,
            this.hideExternalInfoDialog(),
            this.selectedContentType() === 'live'
        );
    }

    selectCategory(category: XtreamCategory) {
        const categoryId = (category as any).category_id ?? category.id;
        console.log('Selected category:', categoryId);
        this.xtreamStore.setSelectedCategory(categoryId);
    }

    backToCategories() {
        this.xtreamStore.setSelectedCategory(null);
    }
}
