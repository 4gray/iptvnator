import {
    DEFAULT_PORTAL_CATEGORY_SORT_MODE,
    WORKSPACE_CATEGORY_SORT_STORAGE_KEY,
    isPortalCategorySortMode,
    persistPortalCategorySortMode,
    restorePortalCategorySortMode,
    sortPortalCategoryItems,
} from './category-sort';

describe('portal category sort', () => {
    beforeEach(() => {
        localStorage.removeItem(WORKSPACE_CATEGORY_SORT_STORAGE_KEY);
    });

    it('defaults to server sorting and ignores invalid stored values', () => {
        expect(DEFAULT_PORTAL_CATEGORY_SORT_MODE).toBe('server');
        expect(restorePortalCategorySortMode()).toBe('server');

        localStorage.setItem(WORKSPACE_CATEGORY_SORT_STORAGE_KEY, 'random');

        expect(restorePortalCategorySortMode()).toBe('server');
    });

    it('persists and restores valid category sort modes', () => {
        persistPortalCategorySortMode('name-desc');

        expect(localStorage.getItem(WORKSPACE_CATEGORY_SORT_STORAGE_KEY)).toBe(
            'name-desc'
        );
        expect(restorePortalCategorySortMode()).toBe('name-desc');
    });

    it('recognizes valid category sort modes', () => {
        expect(isPortalCategorySortMode('server')).toBe(true);
        expect(isPortalCategorySortMode('name-asc')).toBe(true);
        expect(isPortalCategorySortMode('name-desc')).toBe(true);
        expect(isPortalCategorySortMode('date-desc')).toBe(false);
    });

    it('preserves input order for server sorting and supports A-Z/Z-A sorting', () => {
        const categories = [
            { category_name: 'Zulu' },
            { category_name: 'Alpha' },
            { name: 'Movies' },
        ];

        expect(
            sortPortalCategoryItems(
                categories,
                'server',
                (category) => category.category_name ?? category.name
            )
        ).toBe(categories);
        expect(
            sortPortalCategoryItems(
                categories,
                'name-asc',
                (category) => category.category_name ?? category.name
            ).map((category) => category.category_name ?? category.name)
        ).toEqual(['Alpha', 'Movies', 'Zulu']);
        expect(
            sortPortalCategoryItems(
                categories,
                'name-desc',
                (category) => category.category_name ?? category.name
            ).map((category) => category.category_name ?? category.name)
        ).toEqual(['Zulu', 'Movies', 'Alpha']);
    });

    it('keeps pinned entries first when name sorting is active', () => {
        const categories = [
            { category_id: '*', category_name: 'All Categories' },
            { category_id: 'z', category_name: 'Zulu' },
            { category_id: 'a', category_name: 'Alpha' },
        ];

        expect(
            sortPortalCategoryItems(
                categories,
                'name-desc',
                (category) => category.category_name,
                (category) => category.category_id === '*'
            ).map((category) => category.category_name)
        ).toEqual(['All Categories', 'Zulu', 'Alpha']);
    });

    it('ignores accidental provider whitespace around names when sorting', () => {
        const categories = [
            { category_name: ' DENMARK' },
            { category_name: ' SPORTS | INDIA' },
            { category_name: '24/7 PAK DRAMA' },
            { category_name: 'AFGHANISTAN' },
        ];

        expect(
            sortPortalCategoryItems(
                categories,
                'name-asc',
                (category) => category.category_name
            ).map((category) => category.category_name)
        ).toEqual([
            '24/7 PAK DRAMA',
            'AFGHANISTAN',
            ' DENMARK',
            ' SPORTS | INDIA',
        ]);
    });
});
