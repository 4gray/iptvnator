import { focusLiveChannels } from '@iptvnator/ui/components';
import {
    ChangeDetectionStrategy,
    Component,
    effect,
    ElementRef,
    inject,
    input,
    output,
} from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkspaceContextErrorViewComponent } from './workspace-context-error-view.component';

interface WorkspaceCategoryViewItem {
    readonly category_id?: string | number;
    readonly category_name?: string;
    readonly count?: number;
    readonly id?: string | number;
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

    constructor() {
        effect(() => {
            const selectedCategory = this.selectedCategoryId();
            if (selectedCategory == null) {
                return;
            }

            queueMicrotask(() => {
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

                const containerRect = container.getBoundingClientRect();
                const selectedRect = selected.getBoundingClientRect();
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

    onCategoryClick(item: WorkspaceCategoryViewItem): void {
        if (!this.interactionEnabled()) {
            return;
        }

        this.categoryClicked.emit(item);
    }
}
