import { applyEdit } from './server-user-data-edit';

describe('applyEdit', () => {
    it('adds the new favorite to what the server already has', () => {
        expect(applyEdit(['live:1', 'live:2'], [], ['live:9'])).toEqual([
            'live:1',
            'live:2',
            'live:9',
        ]);
        expect(applyEdit(['live:1'], undefined, ['live:9'])).toEqual([
            'live:1',
            'live:9',
        ]);
    });

    it('removes only what the edit removed and replaces changed items', () => {
        expect(
            applyEdit(
                [
                    {
                        contentType: 'vod',
                        contentXtreamId: 1,
                        positionSeconds: 5,
                    },
                    'other',
                ],
                [
                    {
                        contentType: 'vod',
                        contentXtreamId: 1,
                        positionSeconds: 5,
                    },
                ],
                [
                    {
                        contentType: 'vod',
                        contentXtreamId: 1,
                        positionSeconds: 60,
                    },
                ]
            )
        ).toEqual([
            { contentType: 'vod', contentXtreamId: 1, positionSeconds: 60 },
            'other',
        ]);
        expect(applyEdit(['a', 'b'], ['a'], [])).toEqual(['b']);
        // Another device removed 'a'; this edit only added 'c'.
        expect(applyEdit(['b'], ['a', 'b'], ['a', 'b', 'c'])).toEqual([
            'b',
            'c',
        ]);
    });

    it('merges maps by key and passes deletes through', () => {
        expect(applyEdit({ a: 1, b: 2 }, { a: 1 }, { c: 3 })).toEqual({
            b: 2,
            c: 3,
        });
        expect(applyEdit(['x'], ['x'], undefined)).toBeUndefined();
    });
});
