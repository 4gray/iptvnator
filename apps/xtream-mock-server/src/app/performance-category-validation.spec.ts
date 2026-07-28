import {
    isAllowedPerformanceCategory,
    parseRuleBody,
    PerformanceControlError,
} from './performance-control-validation.js';

describe('Xtream performance category validation', () => {
    it.each([
        '091101',
        '+91101',
        ' 91101',
        '91101 ',
        '9.1101e4',
        '9007199254740993',
        '99999999999999999999999999999999999999999999999999',
    ])('rejects the non-canonical category ID %p', (categoryId) => {
        expect(
            isAllowedPerformanceCategory('get_live_streams', categoryId)
        ).toBe(false);

        expect(() =>
            parseRuleBody('barrier', {
                id: 'non-canonical-category',
                match: {
                    scenario: 'performance-100k',
                    transport: 'direct',
                    action: 'get_live_streams',
                    occurrence: 1,
                    categoryId,
                },
            })
        ).toThrow(PerformanceControlError);
    });

    it.each([
        ['get_live_streams', '91101'],
        ['get_live_streams', '91160'],
        ['get_vod_streams', '92101'],
        ['get_vod_streams', '92120'],
        ['get_series', '93101'],
        ['get_series', '93120'],
    ] as const)('accepts canonical %s category %s', (action, categoryId) => {
        expect(isAllowedPerformanceCategory(action, categoryId)).toBe(true);
    });
});
