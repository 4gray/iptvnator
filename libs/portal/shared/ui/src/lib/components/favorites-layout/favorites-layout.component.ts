import { Component, inject, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { PlaylistSwitcherComponent } from '@iptvnator/playlist/shared/ui';
import { isWorkspaceLayoutRoute } from '@iptvnator/portal/shared/util';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from '@iptvnator/ui/components';
import { StalkerPortalItem, XtreamCategory } from '@iptvnator/shared/interfaces';
import { CategoryViewComponent } from '../category-view/category-view.component';
import { ContentCardComponent } from '../content-card/content-card.component';

interface FavoriteLayoutSelection {
    readonly category_id?: string | number;
}

export interface FavoriteLayoutItem {
    readonly added_at?: string | number;
    readonly content_id?: number;
    readonly category_id?: string | number;
    readonly cover?: string;
    readonly details?: {
        readonly info?: {
            readonly name?: string;
        };
    };
    readonly id?: string | number;
    readonly name?: string;
    readonly o_name?: string;
    readonly playlist_id?: string;
    readonly playlist_name?: string;
    readonly poster_url?: string;
    readonly source?: 'xtream' | 'stalker' | 'm3u';
    readonly stalker_item?: StalkerPortalItem;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly type?: string;
    readonly viewed_at?: string;
    readonly xtream_id?: string | number;
}

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
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(inject(ActivatedRoute));

    readonly categories = input<XtreamCategory[]>([]);
    readonly favorites = input<FavoriteLayoutItem[]>([]);
    readonly playlistSubtitle = input<string>('');
    readonly playlistTitle = input<string>('Playlist');
    readonly selectedCategoryId = input<string>('movie');
    readonly titleTranslationString = input<string>('CHANNELS.FAVORITES');
    readonly removeTooltip = input<string>('');
    readonly emptyIcon = input<string>('favorite_border');
    readonly showHeaderAction = input<boolean>(false);
    readonly headerActionIcon = input<string>('delete_sweep');
    readonly headerActionTooltip = input<string>('');

    readonly categoryClicked = output<FavoriteLayoutSelection>();
    readonly removeFavorite = output<FavoriteLayoutItem>();
    readonly openItem = output<FavoriteLayoutItem>();
    readonly headerActionClicked = output<void>();

    setCategoryId(categoryId: string | number) {
        this.categoryClicked.emit({ category_id: categoryId });
    }

    removeFromFavorites(item: FavoriteLayoutItem) {
        this.removeFavorite.emit(item);
    }

    openFavorite(item: FavoriteLayoutItem) {
        this.openItem.emit(item);
    }

    onHeaderActionClick() {
        this.headerActionClicked.emit();
    }
}
