import { combineUserData, unionItems } from './server-migration-merge';

describe('combineUserData', () => {
    it('unions lists, server entries first', () => {
        expect(
            combineUserData([
                ['live:1', 'live:2'],
                ['live:2', 'live:3'],
            ])
        ).toEqual(['live:1', 'live:2', 'live:3']);
    });

    it('merges maps and keeps the first value of a key', () => {
        expect(
            combineUserData([
                { a: { position: 10 } },
                { a: { position: 99 }, b: { position: 5 } },
            ])
        ).toEqual({ a: { position: 10 }, b: { position: 5 } });
    });

    it('ignores missing values and keeps the first of mixed kinds', () => {
        expect(combineUserData([undefined, ['x']])).toEqual(['x']);
        expect(combineUserData([undefined])).toBeUndefined();
        expect(combineUserData([['x'], { a: 1 }])).toEqual(['x']);
    });
});

describe('unionItems', () => {
    it('identifies items by content id or URL', () => {
        expect(
            unionItems(
                [{ id: 1, title: 'Server' }, { url: 'http://a' }],
                [{ id: 1, title: 'Browser' }, { url: 'http://b' }]
            )
        ).toEqual([
            { id: 1, title: 'Server' },
            { url: 'http://a' },
            { url: 'http://b' },
        ]);
    });
});
