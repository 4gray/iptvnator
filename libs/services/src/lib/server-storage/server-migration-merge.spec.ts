import {
    combineUserData,
    retargetUserData,
    unionItems,
} from './server-migration-merge';

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

describe('Stalker items', () => {
    it('keep the same id in different categories apart', () => {
        expect(
            unionItems(
                [{ id: 7, category_id: 'itv', name: 'Channel' }],
                [
                    { id: 7, category_id: 'vod', name: 'Movie' },
                    { id: 7, category_id: 'itv', name: 'Channel again' },
                ]
            )
        ).toEqual([
            { id: 7, category_id: 'itv', name: 'Channel' },
            { id: 7, category_id: 'vod', name: 'Movie' },
        ]);
    });
});

describe('playback positions', () => {
    it('keep the server position of the same item', () => {
        expect(
            combineUserData([
                [
                    {
                        contentType: 'vod',
                        contentXtreamId: 7,
                        positionSeconds: 60,
                    },
                ],
                [
                    {
                        contentType: 'vod',
                        contentXtreamId: 7,
                        positionSeconds: 900,
                    },
                    {
                        contentType: 'episode',
                        contentXtreamId: 7,
                        positionSeconds: 5,
                    },
                ],
            ])
        ).toEqual([
            { contentType: 'vod', contentXtreamId: 7, positionSeconds: 60 },
            { contentType: 'episode', contentXtreamId: 7, positionSeconds: 5 },
        ]);
    });

    it('name the server playlist after a move', () => {
        expect(
            retargetUserData(
                [{ contentXtreamId: 1, playlistId: 'b' }, 'live:1'],
                'b',
                's'
            )
        ).toEqual([{ contentXtreamId: 1, playlistId: 's' }, 'live:1']);
        const same = [{ playlistId: 'b' }];
        expect(retargetUserData(same, 'b', 'b')).toBe(same);
    });
});
