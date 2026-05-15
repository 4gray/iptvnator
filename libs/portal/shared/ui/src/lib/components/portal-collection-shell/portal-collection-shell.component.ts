import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { XtreamCategory } from '@iptvnator/shared/interfaces';
import {
    FavoriteLayoutItem,
    FavoritesLayoutComponent,
} from '../favorites-layout/favorites-layout.component';

interface PortalCategorySelection {
    readonly category_id?: string | number;
    readonly id?: string | number;
}

export interface PortalCollectionShellLayout {
    titleTranslationKey?: string;
    removeTooltip?: string;
    emptyIcon?: string;
    showHeaderAction?: boolean;
    headerActionIcon?: string;
    headerActionTooltip?: string;
}

export type PortalCollectionMode = 'grid' | 'detail' | 'live';

@Component({
    selector: 'app-portal-collection-shell',
    imports: [FavoritesLayoutComponent],
    templateUrl: './portal-collection-shell.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [
        `
            :host {
                display: block;
                height: 100%;
                width: 100%;
            }
        `,
    ],
})
export class PortalCollectionShellComponent {
    readonly categories = input<XtreamCategory[]>([]);
    readonly items = input<FavoriteLayoutItem[]>([]);
    readonly playlistSubtitle = input<string>('');
    readonly playlistTitle = input<string>('Playlist');
    readonly selectedCategoryId = input<string>('all');
    readonly layout = input<PortalCollectionShellLayout>({});
    readonly mode = input<PortalCollectionMode>('grid');

    readonly categoryClicked = output<string>();
    readonly removeItem = output<FavoriteLayoutItem>();
    readonly openItem = output<FavoriteLayoutItem>();
    readonly headerActionClicked = output<void>();

    onCategoryClicked(event: PortalCategorySelection): void {
        const categoryId = event.category_id ?? event.id;
        if (categoryId == null) {
            return;
        }

        this.categoryClicked.emit(String(categoryId));
    }
}
