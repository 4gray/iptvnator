import { Injectable, signal } from '@angular/core';
import { XtreamCategory } from 'shared-interfaces';

/**
 * Lightweight service that bridges the favorites/recently-viewed routed
 * components (inside the router-outlet) with the WorkspaceShellComponent
 * (the outer shell that renders the context panel aside).
 *
 * The routed component pushes its category list here via an effect;
 * the workspace shell reads it to populate the context panel.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesContextService {
    /** Category list managed by the active routed component (Favorites / RecentlyViewed). */
    readonly categories = signal<XtreamCategory[]>([]);

    /** Currently selected category id — shared between panel and content. */
    readonly selectedCategoryId = signal<string>('all');

    /** Called by the context panel when the user clicks a category. */
    setCategoryId(id: string): void {
        this.selectedCategoryId.set(id);
    }

    /** Called by the routed component to push its category list into the panel. */
    setCategories(categories: XtreamCategory[]): void {
        this.categories.set(categories);
    }

    /** Reset to defaults when navigating away from favorites/recent sections. */
    reset(): void {
        this.categories.set([]);
        this.selectedCategoryId.set('all');
    }
}
