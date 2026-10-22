import {
    createScrollPositionPreserver,
    focusLiveChannels,
} from '@iptvnator/ui/components';
import {
    afterRenderEffect,
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    inject,
    input,
    output,
} from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';

interface CategoryViewItem {
    readonly category_id?: string | number;
    readonly category_name?: string;
    readonly count?: number;
    readonly id?: string | number;
    /**
     * Translation key of an entry the app adds itself (a provider's "All"
     * genre); rendered through the pipe so a language switch re-labels it.
     */
    readonly labelKey?: string;
    readonly name?: string;
}

@Component({
    selector: 'app-category-view',
    imports: [MatListModule, PlaylistErrorViewComponent, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './category-view.component.html',
    styleUrls: ['./category-view.component.scss'],
})
export class CategoryViewComponent {
    readonly focusLiveChannels = focusLiveChannels;

    readonly items = input<CategoryViewItem[]>([]);
    readonly selectedCategoryId = input<string | number | null | undefined>();
    readonly itemCounts = input<Map<number, number>>(new Map());
    readonly showCounts = input<boolean>(false);
    private readonly hostEl = inject(ElementRef<HTMLElement>);

    readonly categoryClicked = output<CategoryViewItem>();

    private readonly scrollPosition = createScrollPositionPreserver(
        inject(DestroyRef)
    );

    constructor() {
        // Keep the selected category in view, but only when it is not
        // already: a plain effect can read the DOM before the new selection
        // has rendered (so it centres the PREVIOUS category), and centring
        // a row the user just clicked — already fully visible — yanks the
        // list away from the rows around it. Read the row after the render
        // instead, and leave a fully visible row where it is.
        let revealedSelection: string | number | null | undefined;
        afterRenderEffect(() => {
            const selectedCategory = this.selectedCategoryId();
            // Track the rows too: while they are still loading there is no
            // selected row to reveal, and their arrival must retry.
            this.items();
            if (selectedCategory == null) {
                this.scrollPosition.cancel();
                // A cleared selection must not leave its reveal behind:
                // when the same category is selected again it is revealed
                // afresh.
                revealedSelection = undefined;
                return;
            }
            if (selectedCategory === revealedSelection) {
                return;
            }
            this.scrollPosition.cancel();

            const container = this.hostEl.nativeElement as HTMLElement;
            // Follow the rendered selection: Electron selects by SQLite
            // ID, while data-category-id can contain a provider ID that
            // coincides with a different row's SQLite ID.
            const selected = container.querySelector<HTMLElement>(
                '.category-item[aria-current="true"]'
            );
            if (!selected) {
                return;
            }

            revealedSelection = selectedCategory;

            const containerRect = container.getBoundingClientRect();
            const selectedRect = selected.getBoundingClientRect();
            if (
                selectedRect.top >= containerRect.top &&
                selectedRect.bottom <= containerRect.bottom
            ) {
                // Fully visible — but an earlier reveal may still be
                // smooth-scrolling towards the previous selection; stop
                // it here so it cannot carry this row out of view.
                this.scrollPosition.preserve(container);
                return;
            }

            const targetTop =
                container.scrollTop +
                (selectedRect.top - containerRect.top) -
                container.clientHeight / 2 +
                selectedRect.height / 2;
            const maxScrollTop = Math.max(
                0,
                container.scrollHeight - container.clientHeight
            );

            container.scrollTo({
                behavior: 'smooth',
                top: Math.min(maxScrollTop, Math.max(0, targetTop)),
            });
        });
    }

    isSelected(item: CategoryViewItem): boolean {
        const selectedCategory = this.selectedCategoryId();
        const itemId = item.category_id ?? item.id;

        // Compare as strings to handle both numeric and string category IDs.
        return (
            selectedCategory != null &&
            String(selectedCategory) === String(itemId)
        );
    }

    getItemCount(item: CategoryViewItem): number {
        // content.category_id references categories.id (internal DB id)
        // For DB format categories, use id; for API format, use category_id
        const itemId = Number(item.id ?? item.category_id);
        return this.itemCounts().get(itemId) ?? 0;
    }
}
