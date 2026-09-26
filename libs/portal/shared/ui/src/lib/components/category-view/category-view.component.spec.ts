import { CategoryViewComponent } from './category-view.component';

/**
 * Only `getItemCount` is exercised directly: it is the one piece of logic
 * in the component, and it decides a number the viewer reads off the rail.
 */
describe('CategoryViewComponent.getItemCount', () => {
    const component = (counts: Map<number, number>) => {
        const instance = Object.create(
            CategoryViewComponent.prototype
        ) as CategoryViewComponent;
        Object.defineProperty(instance, 'itemCounts', {
            value: () => counts,
        });
        return instance;
    };

    it('reads the numeric map when the category id is numeric', () => {
        const view = component(new Map([[12, 40]]));

        expect(view.getItemCount({ id: 12 })).toBe(40);
        expect(view.getItemCount({ category_id: 12 })).toBe(40);
    });

    it('prefers the map over the item when both are present', () => {
        // Portal callers keep their counts in the map, and it stays
        // authoritative for them.
        const view = component(new Map([[12, 40]]));

        expect(view.getItemCount({ id: 12, count: 7 })).toBe(40);
    });

    it('falls back to the item count for a non-numeric id', () => {
        // An M3U group's id is the title the provider wrote, which can
        // never be found in a numeric map.
        const view = component(new Map([[12, 40]]));

        expect(view.getItemCount({ id: 'Pazartesi Dizileri', count: 21 })).toBe(
            21
        );
    });

    it('reports zero when neither source knows the category', () => {
        const view = component(new Map());

        expect(view.getItemCount({ id: 'Unknown' })).toBe(0);
    });
});
