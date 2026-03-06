import { Component, inject, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { isWorkspaceLayoutRoute } from '../../navigation/portal-route.utils';
import { CategoryViewComponent } from '../category-view/category-view.component';
import { ContentCardComponent } from '../content-card/content-card.component';

@Component({
    selector: 'app-favorites-layout',
    templateUrl: './favorites-layout.component.html',
    styleUrls: [
        './favorites-layout.component.scss',
        '../../styles/portal-sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        ContentCardComponent,
        MatIcon,
        MatIconButton,
        PlaylistSwitcherComponent,
        ResizableDirective,
        TranslatePipe,
        MatTooltip,
    ],
})
export class FavoritesLayoutComponent {
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(
        inject(ActivatedRoute)
    );

    readonly categories = input<any[]>([]);
    readonly favorites = input<any[]>([]);
    readonly playlistSubtitle = input<string>('');
    readonly playlistTitle = input<string>('Playlist');
    readonly selectedCategoryId = input<string>('movie');
    readonly titleTranslationString = input<string>('CHANNELS.FAVORITES');
    readonly removeTooltip = input<string>('');
    readonly emptyIcon = input<string>('favorite_border');
    readonly showHeaderAction = input<boolean>(false);
    readonly headerActionIcon = input<string>('delete_sweep');
    readonly headerActionTooltip = input<string>('');

    readonly categoryClicked = output<any>();
    readonly removeFavorite = output<any>();
    readonly openItem = output<any>();
    readonly headerActionClicked = output<void>();

    setCategoryId(categoryId: any) {
        this.categoryClicked.emit({ category_id: categoryId });
    }

    removeFromFavorites(item: any) {
        this.removeFavorite.emit(item);
    }

    openFavorite(item: any) {
        this.openItem.emit(item);
    }

    onHeaderActionClick() {
        this.headerActionClicked.emit();
    }
}
