import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistSwitcherComponent } from 'components';
import { CategoryViewComponent } from '../../../xtream-tauri/category-view/category-view.component';

@Component({
    selector: 'app-favorites-layout',
    templateUrl: './favorites-layout.component.html',
    styleUrls: [
        './favorites-layout.component.scss',
        '../../../xtream-tauri/sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        DatePipe,
        MatCardModule,
        MatIcon,
        MatIconButton,
        MatTooltip,
        PlaylistSwitcherComponent,
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
