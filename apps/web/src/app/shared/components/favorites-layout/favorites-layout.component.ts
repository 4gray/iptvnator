import { Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { CategoryViewComponent } from '../../../xtream-tauri/category-view/category-view.component';
import { ContentCardComponent } from '../content-card/content-card.component';

@Component({
    selector: 'app-favorites-layout',
    templateUrl: './favorites-layout.component.html',
    styleUrls: [
        './favorites-layout.component.scss',
        '../../../xtream-tauri/sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        ContentCardComponent,
        MatIcon,
        PlaylistSwitcherComponent,
        ResizableDirective,
        TranslatePipe,
    ],
})
export class FavoritesLayoutComponent {
    readonly categories = input<any[]>([]);
    readonly favorites = input<any[]>([]);
    readonly playlistSubtitle = input<string>('');
    readonly playlistTitle = input<string>('Playlist');
    readonly selectedCategoryId = input<string>('movie');
    readonly titleTranslationString = input<string>('CHANNELS.FAVORITES');

    readonly categoryClicked = output<any>();
    readonly removeFavorite = output<any>();
    readonly openItem = output<any>();

    setCategoryId(categoryId: any) {
        this.categoryClicked.emit({ category_id: categoryId });
    }

    removeFromFavorites(item: any) {
        this.removeFavorite.emit(item);
    }

    openFavorite(item: any) {
        this.openItem.emit(item);
    }
}
