import { Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CategoryViewComponent } from '@iptvnator/portal/shared/ui';
import { FavoritesContextService } from '@iptvnator/portal/shared/util';

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
    imports: [CategoryViewComponent, TranslatePipe],
    template: `
        <div class="context-column">
            <header class="context-header">
                <div class="context-header__top">
                    <h2>
                        {{
                            selectedCategory()?.category_name ||
                                ('WORKSPACE.CONTEXT.FILTER_BY_TYPE' | translate)
                        }}
                    </h2>
                </div>
                @if (selectedCount() !== null) {
                    <span class="context-header__badge">
                        @if (selectedCount() === 1) {
                            {{ 'WORKSPACE.CONTEXT.ITEM_COUNT_ONE' | translate }}
                        } @else {
                            {{
                                'WORKSPACE.CONTEXT.ITEM_COUNT_OTHER'
                                    | translate: { count: selectedCount() }
                            }}
                        }
                    </span>
                }
            </header>

            <div class="context-divider"></div>

            <app-category-view
                [items]="ctx.categories()"
                [selectedCategoryId]="ctx.selectedCategoryId()"
                (categoryClicked)="onCategoryClicked($event)"
            />
        </div>
    `,
    styleUrl: './workspace-context-panel.component.scss',
})
export class WorkspaceFavoritesContextPanelComponent {
    readonly ctx = inject(FavoritesContextService);

    readonly selectedCategory = computed(() => {
        const categories = this.ctx.categories();
        return categories.find(
            (c) => c.category_id === this.ctx.selectedCategoryId()
        );
    });

    readonly selectedCount = computed(
        () => this.selectedCategory()?.count ?? null
    );

    onCategoryClicked(item: {
        category_id?: string | number;
        id?: string | number;
    }): void {
        const id = String(item.category_id ?? item.id ?? 'all');
        this.ctx.setCategoryId(id);
    }
}
