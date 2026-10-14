import { applyEdit, withoutDeleted } from './server-user-data-edit';

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

describe('applyEdit of recently viewed items', () => {
    it('puts a replayed view ahead of older ones', () => {
        const view = (id: string, day: number) => ({
            id,
            viewedAt: `2026-10-0${day}T20:00:00.000Z`,
        });
        // Another device added a view meanwhile; this one is newer still.
        expect(
            applyEdit(
                [view('b', 2), view('a', 1)],
                [view('a', 1)],
                [view('c', 3), view('a', 1)]
            )
        ).toEqual([view('c', 3), view('b', 2), view('a', 1)]);
    });
});

describe('applyEdit of a gone page (yields)', () => {
    it('changes only what is still as that page saw it', () => {
        // Map keys: `a` changed since, `b` did not.
        expect(
            applyEdit({ a: 3, b: 1 }, { a: 1, b: 1 }, { a: 2, b: 2 }, true)
        ).toEqual({ a: 3, b: 2 });
        // List items by key: a changed item keeps its newer state.
        const item = (seconds: number) => ({
            contentType: 'vod',
            contentXtreamId: 1,
            positionSeconds: seconds,
        });
        expect(applyEdit([item(30)], [item(10)], [item(20)], true)).toEqual([
            item(30),
        ]);
        expect(applyEdit([item(10)], [item(10)], [item(20)], true)).toEqual([
            item(20),
        ]);
        // Adds and removes still apply where nothing changed.
        expect(applyEdit(['a', 'b'], ['a', 'b'], ['b', 'c'], true)).toEqual([
            'b',
            'c',
        ]);
    });

    it('keeps a value or entry replaced since', () => {
        expect(applyEdit('new', 'old', 'mine', true)).toBe('new');
        expect(applyEdit('old', 'old', 'mine', true)).toBe('mine');
        expect(applyEdit(['x', 'y'], ['x'], undefined, true)).toEqual([
            'x',
            'y',
        ]);
        expect(applyEdit(['x'], ['x'], undefined, true)).toBeUndefined();
    });
});

describe('withoutDeleted', () => {
    it('drops deleted playlists and keeps every other id', () => {
        const read = withoutDeleted(
            {
                entries: {
                    'xtream-favorites': JSON.parse(
                        '{"gone":["a"],"__proto__":["b"],"kept":["c"]}'
                    ),
                    'xtream-recent-items': {},
                    'xtream-collection-items': {},
                    'xtream-playback-positions': {},
                },
                tags: {
                    'xtream-favorites': JSON.parse(
                        '{"gone":"t1","__proto__":"t2","kept":"t3"}'
                    ),
                    'xtream-recent-items': {},
                    'xtream-collection-items': {},
                    'xtream-playback-positions': {},
                },
            },
            ['gone']
        );

        expect(Object.keys(read.entries['xtream-favorites'])).toEqual([
            '__proto__',
            'kept',
        ]);
        expect(read.entries['xtream-favorites']['__proto__']).toEqual(['b']);
        expect(read.tags?.['xtream-favorites']['__proto__']).toBe('t2');
    });
});
