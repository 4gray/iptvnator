import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { XtreamCategory } from 'shared-interfaces';
import { FavoritesLayoutComponent } from '../favorites-layout/favorites-layout.component';

export interface PortalCollectionShellLayout {
    titleTranslationKey?: string;
    removeTooltip?: string;
    emptyIcon?: string;
    showHeaderAction?: boolean;
    headerActionIcon?: string;
    headerActionTooltip?: string;
}

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
    readonly items = input<any[]>([]);
    readonly playlistSubtitle = input<string>('');
    readonly playlistTitle = input<string>('Playlist');
    readonly selectedCategoryId = input<string>('all');
    readonly layout = input<PortalCollectionShellLayout>({});
    readonly showDetails = input<boolean>(false);

    readonly categoryClicked = output<string>();
    readonly removeItem = output<any>();
    readonly openItem = output<any>();
    readonly headerActionClicked = output<void>();

    onCategoryClicked(event: { category_id?: string }) {
        if (!event?.category_id) {
            return;
        }

        this.categoryClicked.emit(event.category_id);
    }
}
