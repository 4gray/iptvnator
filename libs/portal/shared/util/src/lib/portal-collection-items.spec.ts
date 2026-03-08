import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
} from './portal-collection-items';

describe('portal-collection-items', () => {
    it('builds 4-category collections when live content is included', () => {
        const categories = buildStandardCollectionCategories({
            labels: {
                all: 'All',
                movie: 'Movies',
                live: 'Live TV',
                series: 'Series',
            },
            counts: {
                all: 10,
                movie: 4,
                live: 3,
                series: 3,
            },
            includeLive: true,
        });

        expect(categories.map((category) => category.category_id)).toEqual([
            'all',
            'movie',
            'live',
            'series',
        ]);
        expect(categories[2]?.count).toBe(3);
    });

    it('supports alternate live category ids for stalker collections', () => {
        const categories = buildStandardCollectionCategories({
            labels: {
                all: 'All',
                movie: 'Movies',
                live: 'Live TV',
                series: 'Series',
            },
            counts: {
                all: 3,
                movie: 1,
                live: 1,
                series: 1,
            },
            includeLive: true,
            liveCategoryId: 'itv',
        });

        expect(categories[2]?.category_id).toBe('itv');
    });

    it('builds 3-category collections when live content is excluded', () => {
        const categories = buildStandardCollectionCategories({
            labels: {
                all: 'All',
                movie: 'Movies',
                live: 'Live TV',
                series: 'Series',
            },
            counts: {
                all: 5,
                movie: 2,
                series: 3,
            },
            includeLive: false,
        });

        expect(categories.map((category) => category.category_id)).toEqual([
            'all',
            'movie',
            'series',
        ]);
        expect(categories[2]?.id).toBe(3);
    });

    it('filters items by selected category', () => {
        const items = [
            { title: 'Movie 1' },
            { title: 'Series 1' },
            { title: 'Live 1' },
        ];

        const filtered = filterCollectionBucket({
            selectedCategoryId: 'series',
            allItems: items,
            buckets: {
                movie: [items[0]],
                live: [items[2]],
                series: [items[1]],
            },
            searchTerm: '',
            textOf: (item) => item.title,
        });

        expect(filtered).toEqual([items[1]]);
    });

    it('filters alternate live buckets without changing stalker category ids', () => {
        const items = [
            { name: 'Movie' },
            { name: 'Live' },
        ];

        const filtered = filterCollectionBucket({
            selectedCategoryId: 'itv',
            allItems: items,
            buckets: {
                movie: [items[0]],
                live: [items[1]],
            },
            liveCategoryId: 'itv',
            textOf: (item) => item.name,
        });

        expect(filtered).toEqual([items[1]]);
    });

    it('filters items by search term using the provided text selector', () => {
        const items = [
            { name: 'Alien', o_name: 'Extended Cut' },
            { name: 'Matrix', o_name: 'Neo' },
        ];

        const filtered = filterCollectionBucket({
            selectedCategoryId: 'all',
            allItems: items,
            buckets: {
                movie: items,
            },
            searchTerm: 'neo',
            textOf: (item) => `${item.name} ${item.o_name}`,
        });

        expect(filtered).toEqual([items[1]]);
    });
});
