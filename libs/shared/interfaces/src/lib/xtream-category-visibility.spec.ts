import {
    parseXtreamCategoryVisibility,
    xtreamCategoryVisibilityKey,
} from './xtream-category-visibility';

const valid = {
    version: 1,
    categories: [
        { categoryType: 'movies', xtreamId: 91, hidden: false },
        { categoryType: 'live', xtreamId: 91, hidden: true },
    ],
};

it('preserves explicit false and typed source-scoped identities', () => {
    expect(xtreamCategoryVisibilityKey('synthetic-source')).toBe(
        'xtream-category-visibility:synthetic-source'
    );
    expect(parseXtreamCategoryVisibility(JSON.stringify(valid))).toEqual(valid);
});

it.each([
    null,
    {},
    { ...valid, version: 2 },
    { ...valid, categories: null },
    { ...valid, categories: 'invalid' },
    { ...valid, categories: [null] },
    {
        ...valid,
        categories: [{ categoryType: 'movie', xtreamId: 91, hidden: false }],
    },
    {
        ...valid,
        categories: [{ categoryType: 'movies', xtreamId: '91', hidden: false }],
    },
    {
        ...valid,
        categories: [{ categoryType: 'movies', xtreamId: null, hidden: false }],
    },
    { ...valid, categories: [{ categoryType: 'movies', xtreamId: 91 }] },
    {
        ...valid,
        categories: [{ categoryType: 'movies', xtreamId: 91, hidden: 'false' }],
    },
])(
    'rejects malformed explicit visibility without defaulting to empty: %j',
    (value) => {
        expect(() =>
            parseXtreamCategoryVisibility(JSON.stringify(value))
        ).toThrow();
    }
);

it('rejects unreadable native state', () => {
    expect(() => parseXtreamCategoryVisibility('{broken')).toThrow();
});
