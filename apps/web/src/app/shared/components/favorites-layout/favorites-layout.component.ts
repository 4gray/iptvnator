import { DatePipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { CategoryViewComponent } from '../../../xtream-tauri/category-view/category-view.component';
import { MpvPlayerBarComponent } from '../mpv-player-bar/mpv-player-bar.component';

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
        MpvPlayerBarComponent,
        MatTooltip,
        TranslatePipe,
    ],
})
export class FavoritesLayoutComponent {
    readonly categories = input<any[]>([]);
    readonly favorites = input<any[]>([]);
    readonly selectedCategoryId = input<string>('movie');
    readonly titleTranslationString = input<string>('CHANNELS.FAVORITES');

    readonly categoryClicked = output<any>();
    readonly removeFromFavorites = output<any>();
    readonly openItem = output<any>();

    setCategoryId(categoryId: any) {
        this.categoryClicked.emit({ category_id: categoryId });
    }

    removeFavorite(item: any) {
        this.removeFromFavorites.emit(item);
    }

    openFavorite(item: any) {
        this.openItem.emit(item);
    }
}
