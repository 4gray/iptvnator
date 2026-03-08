import {
    createEnvironmentInjector,
    EnvironmentInjector,
    runInInjectionContext,
    signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FavoritesContextService } from './favorites-context.service';
import { createPortalCollectionContext } from './portal-collection-context';

describe('portal-collection-context', () => {
    it('syncs categories into the favorites context', () => {
        TestBed.configureTestingModule({
            providers: [FavoritesContextService],
        });

        const parentInjector = TestBed.inject(EnvironmentInjector);
        const childInjector = createEnvironmentInjector([], parentInjector);
        const ctx = TestBed.inject(FavoritesContextService);
        const categories = signal([
            {
                id: 1,
                category_id: 'all',
                category_name: 'All',
                count: 2,
                parent_id: 0,
            },
        ]);

        const bridge = runInInjectionContext(childInjector, () =>
            createPortalCollectionContext({
                ctx,
                categories,
            })
        );
        TestBed.flushEffects();

        bridge.setCategoryId('all');

        expect(ctx.categories()).toEqual(categories());
        expect(ctx.selectedCategoryId()).toBe('all');

        childInjector.destroy();
    });

    it('does not mutate the shared context when disabled', () => {
        TestBed.configureTestingModule({
            providers: [FavoritesContextService],
        });

        const parentInjector = TestBed.inject(EnvironmentInjector);
        const childInjector = createEnvironmentInjector([], parentInjector);
        const ctx = TestBed.inject(FavoritesContextService);
        const categories = signal([
            {
                id: 1,
                category_id: 'movie',
                category_name: 'Movies',
                count: 1,
                parent_id: 0,
            },
        ]);

        ctx.setCategories([
            {
                id: 99,
                category_id: 'all',
                category_name: 'Existing',
                count: 5,
                parent_id: 0,
            },
        ]);
        ctx.setCategoryId('series');

        const bridge = runInInjectionContext(childInjector, () =>
            createPortalCollectionContext({
                ctx,
                categories,
                enabled: () => false,
            })
        );
        TestBed.flushEffects();

        bridge.setCategoryId('movie');

        expect(ctx.categories()[0]?.category_name).toBe('Existing');
        expect(ctx.selectedCategoryId()).toBe('series');

        childInjector.destroy();

        expect(ctx.categories()[0]?.category_name).toBe('Existing');
        expect(ctx.selectedCategoryId()).toBe('series');
    });

    it('resets managed context state on destroy', () => {
        TestBed.configureTestingModule({
            providers: [FavoritesContextService],
        });

        const parentInjector = TestBed.inject(EnvironmentInjector);
        const childInjector = createEnvironmentInjector([], parentInjector);
        const ctx = TestBed.inject(FavoritesContextService);
        const categories = signal([
            {
                id: 1,
                category_id: 'all',
                category_name: 'All',
                count: 3,
                parent_id: 0,
            },
        ]);

        runInInjectionContext(childInjector, () =>
            createPortalCollectionContext({
                ctx,
                categories,
            })
        );
        TestBed.flushEffects();

        ctx.setCategoryId('movie');

        childInjector.destroy();
        TestBed.flushEffects();

        expect(ctx.categories()).toEqual([]);
        expect(ctx.selectedCategoryId()).toBe('all');
    });
});
