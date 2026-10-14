import {
    combineUserData,
    remapChannelReferences,
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

    it('keep a movie and a series of one provider category apart', () => {
        expect(
            unionItems<Record<string, unknown>>(
                [{ id: 7, category_id: '12', name: 'Movie' }],
                [
                    { id: 7, category_id: '12', is_series: 1, name: 'Show' },
                    {
                        id: 7,
                        category_id: '12',
                        is_series: true,
                        name: 'Again',
                    },
                ]
            )
        ).toEqual([
            { id: 7, category_id: '12', name: 'Movie' },
            { id: 7, category_id: '12', is_series: 1, name: 'Show' },
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

describe('remapChannelReferences', () => {
    const browser = [
        { id: 'b1', url: 'http://s/1' },
        { id: 'b2', url: 'http://s/2' },
        { id: 'b3', url: 'http://s/gone' },
    ];
    const server = [
        { id: 's1', url: 'http://s/1' },
        { id: 's2', url: 'http://s/2' },
    ];

    it('turns legacy channel-id favorites into their stream URL', () => {
        expect(
            remapChannelReferences(['b2', 'b1', 'http://s/1'], browser, server)
        ).toEqual(['http://s/2', 'http://s/1', 'http://s/1']);
        // The server's own legacy ids, against its own channels.
        expect(remapChannelReferences(['s1'], server, server)).toEqual([
            'http://s/1',
        ]);
    });

    it('keeps URL favorites and anything it cannot resolve', () => {
        expect(
            remapChannelReferences(
                ['http://elsewhere/9', 'b9', 'b3'],
                browser,
                server
            )
        ).toEqual(['http://elsewhere/9', 'b9', 'http://s/gone']);
    });

    it("keeps a history entry's URL id and names the server's channel", () => {
        const portal = { id: 7, category_id: 'itv' };
        const entry = {
            source: 'm3u',
            id: 'http://s/1',
            url: 'http://s/1',
            channel_id: 'b1',
        };
        expect(
            remapChannelReferences([entry, portal], browser, server)
        ).toEqual([{ ...entry, channel_id: 's1' }, portal]);
    });
});
