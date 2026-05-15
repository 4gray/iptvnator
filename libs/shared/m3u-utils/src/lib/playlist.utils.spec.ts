import { Channel, Playlist } from '@iptvnator/shared/interfaces';
import {
    aggregateFavoriteChannels,
    getExtensionFromUrl,
    getStreamExtensionFromUrl,
} from './playlist.utils';

function createChannel(id: string, url: string, name = id): Channel {
    return {
        group: { title: 'Group' },
        http: {
            origin: '',
            referrer: '',
            'user-agent': '',
        },
        id,
        name,
        radio: 'false',
        tvg: {
            id,
            logo: '',
            name,
            rec: '',
            url: '',
        },
        url,
    };
}

function createPlaylist(
    id: string,
    channels: Channel[],
    favorites: Playlist['favorites']
): Playlist {
    return {
        _id: id,
        autoRefresh: false,
        count: channels.length,
        favorites,
        importDate: '2026-01-01T00:00:00.000Z',
        lastUsage: '2026-01-01T00:00:00.000Z',
        playlist: {
            items: channels,
        },
        title: id,
    };
}

describe('playlist utils', () => {
    it('aggregates M3U favorite channels with constant-time id and URL lookups', () => {
        const first = createChannel(
            'channel-1',
            'https://example.com/stream-1.m3u8',
            'Channel One'
        );
        const second = createChannel(
            'channel-2',
            'https://example.com/stream-2.m3u8',
            'Channel Two'
        );
        const third = createChannel(
            'channel-3',
            'https://example.com/stream-3.m3u8',
            'Channel Three'
        );

        const result = aggregateFavoriteChannels([
            createPlaylist(
                'playlist-1',
                [first, second],
                ['channel-1', 'missing-channel']
            ),
            createPlaylist(
                'playlist-2',
                [third],
                ['https://example.com/stream-3.m3u8']
            ),
        ]);

        expect(result).toEqual([first, third]);
    });

    describe('getExtensionFromUrl', () => {
        it.each([
            ['https://host/path/file.ts?token=x', 'ts'],
            ['https://host/ace/getstream?infohash=x', undefined],
            ['https://host/path.with.dots/stream?x=y', undefined],
            ['https://host/path/file.m3u8', 'm3u8'],
            ['https://host/path/.ts', undefined],
        ])('extracts the path extension from %s', (url, expected) => {
            expect(getExtensionFromUrl(url)).toBe(expected);
        });
    });

    describe('getStreamExtensionFromUrl', () => {
        it.each([
            ['https://host/play?extension=m3u8&token=x', 'm3u8'],
            ['https://host/live.php?stream=123&extension=ts', 'ts'],
            ['https://host/path/file.ts?token=x', 'ts'],
            ['https://host/ace/getstream?infohash=x', undefined],
        ])(
            'prefers declared stream extension metadata from %s',
            (url, expected) => {
                expect(getStreamExtensionFromUrl(url)).toBe(expected);
            }
        );
    });
});
