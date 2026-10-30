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
import { WorkspaceContextErrorViewComponent } from './workspace-context-error-view.component';

export interface WorkspaceCategoryViewItem {
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
    selector: 'app-workspace-context-category-view',
    imports: [MatListModule, TranslatePipe, WorkspaceContextErrorViewComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './workspace-context-category-view.component.html',
    styleUrl: './workspace-context-category-view.component.scss',
})
export class WorkspaceContextCategoryViewComponent {
    readonly items = input<ReadonlyArray<WorkspaceCategoryViewItem>>([]);
    readonly selectedCategoryId = input<string | number | null | undefined>();
    readonly itemCounts = input<Map<number, number>>(new Map());
    readonly showCounts = input(false);
    readonly countDisplayMode = input<'loading' | 'ready'>('ready');
    /**
     * When true, items without an entry in `itemCounts` render no badge at
     * all instead of "0" — used for Stalker censored (adult) genres whose
     * real channel count is unknown to the full-list cache.
     */
    readonly omitMissingCounts = input(false);
    readonly interactionEnabled = input(true);
    readonly statusText = input('');
    /**
     * The in-flow shell rail takes part in the live-TV column keyboard
     * contract: it is `#portal-categories` (ArrowLeft from the channels pane
     * lands on the selected category) and ArrowRight on that category hands
     * focus to `#live-channels`. The same view stamped into the categories
     * popover must opt out: the dialog's focus trap would bounce that
     * handoff back into the dialog, and a second `#portal-categories` would
     * shadow the folded rail's.
     */
    readonly columnHandoff = input(true);

    onCategoryKeydown(event: KeyboardEvent): void {
        // A method, not an inline `&&`: an event binding whose expression
        // evaluates to `false` makes Angular call preventDefault().
        if (this.columnHandoff()) {
            focusLiveChannels(event);
        }
    }

    private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

    readonly categoryClicked = output<WorkspaceCategoryViewItem>();
    /** Right-click on a row; the host decides whether a menu applies. */
    readonly categoryContextMenuRequested = output<{
        item: WorkspaceCategoryViewItem;
        event: MouseEvent;
    }>();

    private readonly scrollPosition = createScrollPositionPreserver(
        inject(DestroyRef)
    );

    constructor() {
        // Keep the selected category in view, but only when it is not
        // already: a plain effect can read the DOM before the new selection
        // has rendered (so it centres the PREVIOUS category, often deep in
        // the list), and centring a row the user just clicked — already
        // fully visible — yanks the rail away from the rows around it, so
        // the next pick starts with scrolling back. Read the row after the
        // render instead, and leave a fully visible row where it is.
        let revealedSelection: string | number | null | undefined;
        afterRenderEffect(() => {
            const selectedCategory = this.selectedCategoryId();
            // Track the rows too: while they are still loading there is no
            // selected row to reveal, and their arrival must retry.
            this.items();
            if (selectedCategory == null) {
                this.scrollPosition.cancel();
                // A cleared selection must not leave its reveal behind:
                // when the same category is selected again (e.g. a search
                // that matched nothing is cleared) it is revealed afresh.
                revealedSelection = undefined;
                return;
            }
            if (selectedCategory === revealedSelection) {
                return;
            }
            this.scrollPosition.cancel();

            const container = this.hostEl.nativeElement;
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

    isSelected(item: WorkspaceCategoryViewItem): boolean {
        const selectedCategory = this.selectedCategoryId();
        const itemId = item.category_id ?? item.id;
        return (
            selectedCategory != null &&
            String(selectedCategory) === String(itemId)
        );
    }

    getItemCount(item: WorkspaceCategoryViewItem): number {
        const itemId = Number(item.id ?? item.category_id);
        return this.itemCounts().get(itemId) ?? 0;
    }

    hasItemCount(item: WorkspaceCategoryViewItem): boolean {
        if (!this.omitMissingCounts()) {
            return true;
        }

        // NaN (from the "*" all-category id) is a valid Map key here.
        return this.itemCounts().has(Number(item.id ?? item.category_id));
    }

    onCategoryContextMenu(
        item: WorkspaceCategoryViewItem,
        event: MouseEvent
    ): void {
        this.categoryContextMenuRequested.emit({ item, event });
    }

    onCategoryClick(item: WorkspaceCategoryViewItem): void {
        if (!this.interactionEnabled()) {
            return;
        }

        this.categoryClicked.emit(item);
    }
}
