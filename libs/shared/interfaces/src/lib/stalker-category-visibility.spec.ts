import {
    applyStalkerCategoryVisibility,
    isHiddenStalkerCategories,
} from './stalker-category-visibility';

describe('Stalker category visibility', () => {
    it('accepts sparse section maps with exact, non-wildcard provider IDs', () => {
        expect(isHiddenStalkerCategories({})).toBe(true);
        expect(isHiddenStalkerCategories({ itv: ['01', '1'], radio: [] })).toBe(
            true
        );
        for (const malformed of [
            null,
            [],
            '01',
            { live: ['01'] },
            { vod: '01' },
            { series: [1] },
            { itv: [' * '] },
            { radio: [' '] },
        ]) {
            expect(isHiddenStalkerCategories(malformed)).toBe(false);
        }
    });

    it('applies only edited IDs and drops a section when its last hidden category is restored', () => {
        const original = { itv: ['01', '1'], series: ['01'] };
        const updated = applyStalkerCategoryVisibility(original, {
            itv: { show: ['1'] },
            series: { show: ['01'] },
            radio: { hide: ['01', '*', ' ', '01'] },
        });
        expect(updated).toEqual({ itv: ['01'], radio: ['01'] });
        expect(original).toEqual({ itv: ['01', '1'], series: ['01'] });
        expect(
            applyStalkerCategoryVisibility(undefined, { vod: { show: ['01'] } })
        ).toEqual({});
    });
});
