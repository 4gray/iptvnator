import { DestroyRef, Signal, effect, inject } from '@angular/core';
import { XtreamCategory } from 'shared-interfaces';
import { FavoritesContextService } from '../../workspace/favorites-context.service';

export interface PortalCollectionContextBridge {
    readonly selectedCategoryId: Signal<string>;
    setCategoryId(id: string): void;
}

interface CreatePortalCollectionContextOptions {
    ctx: FavoritesContextService;
    categories: () => XtreamCategory[];
    enabled?: () => boolean;
}

export function createPortalCollectionContext(
    options: CreatePortalCollectionContextOptions
): PortalCollectionContextBridge {
    const destroyRef = inject(DestroyRef);
    const isEnabled = options.enabled ?? (() => true);
    let managesContext = false;

    effect(() => {
        if (!isEnabled()) {
            return;
        }

        managesContext = true;
        options.ctx.setCategories(options.categories());
    });

    destroyRef.onDestroy(() => {
        if (managesContext && isEnabled()) {
            options.ctx.reset();
        }
    });

    return {
        selectedCategoryId: options.ctx.selectedCategoryId,
        setCategoryId(id: string): void {
            if (isEnabled()) {
                options.ctx.setCategoryId(id);
            }
        },
    };
}
