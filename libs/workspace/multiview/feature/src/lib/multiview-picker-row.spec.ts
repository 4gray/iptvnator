import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import { liveItem, movieItem, tile } from './multiview-picker.fixtures';
import {
    pickerSessionKey,
    providerContentId,
    tileKindOf,
    tileNumberFor,
    toPickerRow,
} from './multiview-picker-row';

describe('multiview picker rows', () => {
    it('maps content types to tile kinds; radio and series are not tiles', () => {
        expect(tileKindOf(liveItem(1))).toBe('live');
        expect(tileKindOf(movieItem(2))).toBe('vod');
        expect(tileKindOf(movieItem(3, { contentType: 'series' }))).toBeNull();
        expect(tileKindOf(liveItem(4, { radio: 'true' }))).toBeNull();
    });

    it.each([
        [liveItem(7), 7],
        [
            liveItem(8, {
                sourceType: 'stalker',
                xtreamId: undefined,
                stalkerId: 's8',
            }),
            's8',
        ],
        [
            liveItem(9, {
                sourceType: 'm3u',
                xtreamId: undefined,
                channelId: 'c9',
            }),
            'c9',
        ],
    ])('reads the provider id the views key by', (item, expected) => {
        expect(providerContentId(item)).toBe(expected);
    });

    it('builds the same session key a live view gives its channel', () => {
        expect(pickerSessionKey(liveItem(7))).toBe(
            createPlaybackSessionKey({
                kind: 'live',
                sourceId: 'playlist-1',
                contentId: 7,
            })
        );
        expect(pickerSessionKey(movieItem(7))).toBe(
            createPlaybackSessionKey({
                kind: 'vod',
                sourceId: 'playlist-1',
                contentId: 7,
            })
        );
    });

    describe('tileNumberFor', () => {
        it('finds a tile by session key', () => {
            const tiles = [
                tile({ id: 'a' }),
                tile({
                    id: 'b',
                    playbackSessionKey: pickerSessionKey(liveItem(7)),
                }),
            ];

            expect(tileNumberFor(liveItem(7), tiles)).toBe(2);
        });

        it('finds a tile by playlist and provider id of the same kind', () => {
            const tiles = [tile({ id: 'a', contentId: '7' })];

            expect(tileNumberFor(liveItem(7), tiles)).toBe(1);
            expect(tileNumberFor(movieItem(7), tiles)).toBeNull();
            expect(
                tileNumberFor(liveItem(7, { playlistId: 'playlist-2' }), tiles)
            ).toBeNull();
        });

        it('finds a tile by stream URL', () => {
            const tiles = [
                tile({
                    id: 'a',
                    playback: {
                        streamUrl: 'https://stream.example/m.ts',
                        title: 'm',
                    },
                }),
            ];

            expect(
                tileNumberFor(
                    liveItem(3, {
                        sourceType: 'm3u',
                        streamUrl: 'https://stream.example/m.ts',
                    }),
                    tiles
                )
            ).toBe(1);
        });
    });

    it('marks a row already on screen', () => {
        const row = toPickerRow(liveItem(7), [
            tile({ id: 'a', contentId: '7' }),
        ]);

        expect(row).toMatchObject({ kind: 'live', inTile: 1, program: null });
    });
});
