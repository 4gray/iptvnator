import { Component, computed, inject } from '@angular/core';
import { CategoryViewComponent } from '../xtream-electron/category-view/category-view.component';
import { FavoritesContextService } from './favorites-context.service';

/**
 * Context panel rendered in the workspace-shell aside for
 * favorites and recently-viewed sections.
 *
 * Reads categories from FavoritesContextService (populated by the
 * routed FavoritesComponent / RecentlyViewedComponent) and emits
 * category selections back through the same service.
 */
@Component({
    selector: 'app-workspace-favorites-context-panel',
    imports: [CategoryViewComponent],
    template: `
        <div class="context-column">
            <header class="context-header">
                <div class="context-header__top">
                    <h2>{{ title() }}</h2>
                </div>
                @if (countBadge(); as text) {
                    <span class="context-header__badge">{{ text }}</span>
                }
            </header>

            <div class="context-divider"></div>

            <app-category-view
                [items]="ctx.categories()"
                [selectedCategoryId]="ctx.selectedCategoryId()"
                (categoryClicked)="onCategoryClicked($any($event))"
            />
        </div>
    `,
    styleUrl: './workspace-context-panel.component.scss',
})
export class WorkspaceFavoritesContextPanelComponent {
    readonly ctx = inject(FavoritesContextService);

    readonly title = computed(() => {
        const categories = this.ctx.categories();
        if (!categories.length) return 'Filter by type';
        const selected = categories.find(
            (c: any) => c.category_id === this.ctx.selectedCategoryId()
        ) as any;
        return selected?.category_name ?? 'Filter by type';
    });

    readonly countBadge = computed(() => {
        const categories = this.ctx.categories();
        const selected = categories.find(
            (c: any) => c.category_id === this.ctx.selectedCategoryId()
        ) as any;
        if (!selected || selected.count === undefined) return '';
        return `${selected.count} ${selected.count === 1 ? 'item' : 'items'}`;
    });

    onCategoryClicked(item: { category_id?: string | number }): void {
        const id = String(item.category_id ?? 'all');
        this.ctx.setCategoryId(id);
    }
}
