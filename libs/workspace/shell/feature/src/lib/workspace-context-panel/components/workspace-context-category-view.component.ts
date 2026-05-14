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
    readonly interactionEnabled = input(true);
    readonly statusText = input('');

    private readonly hostEl = inject(ElementRef<HTMLElement>);

    readonly categoryClicked = output<WorkspaceCategoryViewItem>();

    constructor() {
        effect(() => {
            const selectedCategory = this.selectedCategoryId();
            if (selectedCategory == null) {
                return;
            }

            queueMicrotask(() => {
                const container = this.hostEl.nativeElement;
                const candidates = Array.from(
                    container.querySelectorAll('[data-category-id]')
                ) as HTMLElement[];
                const selected = candidates.find(
                    (el) =>
                        el.dataset['categoryId'] === String(selectedCategory)
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

    onCategoryClick(item: WorkspaceCategoryViewItem): void {
        if (!this.interactionEnabled()) {
            return;
        }

        this.categoryClicked.emit(item);
    }
}
