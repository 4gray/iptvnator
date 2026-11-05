import {
    buildCollectionViewState,
    COLLECTION_VIEW_STATE_KEY,
    getCollectionViewState,
} from './collection-view-state';

const stateKey = COLLECTION_VIEW_STATE_KEY;
const malformedRecords = [
    undefined,
    null,
    false,
    12,
    'synthetic',
    [],
    {},
    () => undefined,
];

describe('collection view state validation', () => {
    it.each([
        ['live', 'playlist'],
        ['movie', 'all'],
        ['series', 'playlist'],
    ] as const)(
        'accepts the %s tab with %s scope',
        (selectedContentType, scope) => {
            const view = { selectedContentType, scope };
            expect(buildCollectionViewState(view)).toEqual(view);
            expect(getCollectionViewState({ [stateKey]: view })).toEqual(view);
        }
    );

    it.each([
        { selectedContentType: 'movie' as const },
        { scope: 'all' as const },
    ])('preserves a valid partial view: %j', (view) => {
        expect(buildCollectionViewState(view)).toEqual(view);
        expect(getCollectionViewState({ [stateKey]: view })).toEqual(view);
    });

    it('omits null fields instead of persisting them', () => {
        expect(
            buildCollectionViewState({
                selectedContentType: null,
                scope: 'playlist',
            })
        ).toEqual({ scope: 'playlist' });
        expect(
            buildCollectionViewState({
                selectedContentType: 'series',
                scope: null,
            })
        ).toEqual({ selectedContentType: 'series' });
        expect(
            buildCollectionViewState({ selectedContentType: null, scope: null })
        ).toBeNull();
        expect(buildCollectionViewState({})).toBeNull();
    });

    it.each(malformedRecords.map((value) => [value]))(
        'ignores a malformed history record: %p',
        (state) => {
            expect(getCollectionViewState(state)).toBeNull();
        }
    );

    it.each(malformedRecords.map((value) => [value]))(
        'ignores a malformed nested view: %p',
        (view) => {
            expect(getCollectionViewState({ [stateKey]: view })).toBeNull();
        }
    );

    it.each([
        [{ selectedContentType: 'unknown', scope: 'all' }, { scope: 'all' }],
        [
            { selectedContentType: 'series', scope: 'unknown' },
            { selectedContentType: 'series' },
        ],
        [{ selectedContentType: 'unknown', scope: 'unknown' }, null],
        [{ selectedContentType: 1, scope: true }, null],
    ])(
        'retains only the independently valid fields of %j',
        (candidate, expected) => {
            expect(getCollectionViewState({ [stateKey]: candidate })).toEqual(
                expected
            );
        }
    );

    it('does not carry extra history or nested handoff fields', () => {
        expect(
            getCollectionViewState({
                navigationId: 12,
                openLiveCollectionItem: { itemId: 'synthetic-item' },
                [stateKey]: {
                    selectedContentType: 'movie',
                    scope: 'all',
                    openCollectionDetailItem: { item: 'synthetic-item' },
                },
            })
        ).toEqual({ selectedContentType: 'movie', scope: 'all' });
    });
});
