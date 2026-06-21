import { Channel, Playlist } from '@iptvnator/shared/interfaces';
import {
    aggregateFavoriteChannels,
    createPlaylistObject,
    extractM3uEpgUrls,
    filterPlaylistEpgUrlsForFetch,
    getExtensionFromUrl,
    getStreamExtensionFromUrl,
    resolvePlaylistEpgSourceState,
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

    describe('extractM3uEpgUrls', () => {
        it('extracts and deduplicates playlist-scoped EPG URLs from supported M3U header attributes', () => {
            expect(
                extractM3uEpgUrls({
                    header: {
                        attrs: {
                            'x-tvg-url':
                                ' https://example.com/guide.xml, https://example.com/guide.xml https://example.com/extra.xml.gz ',
                            'url-tvg': 'https://example.com/url-tvg.xml',
                        },
                        raw: '#EXTM3U x-tvg-url="https://example.com/guide.xml" url-tvg="https://example.com/url-tvg.xml"',
                    },
                })
            ).toEqual([
                'https://example.com/guide.xml',
                'https://example.com/extra.xml.gz',
                'https://example.com/url-tvg.xml',
            ]);
        });

        it('falls back to the raw header for tvg-url variants the parser does not expose as attrs', () => {
            expect(
                extractM3uEpgUrls({
                    header: {
                        attrs: {},
                        raw: '#EXTM3U tvg-url="https://example.com/raw-guide.xml"',
                    },
                })
            ).toEqual(['https://example.com/raw-guide.xml']);
        });
    });

    it('stores detected M3U EPG URLs on the created playlist', () => {
        const playlist = createPlaylistObject('Playlist with EPG', {
            header: {
                attrs: {
                    'x-tvg-url': 'https://example.com/guide.xml',
                },
                raw: '#EXTM3U x-tvg-url="https://example.com/guide.xml"',
            },
            items: [],
        });

        expect(playlist.epgUrls).toEqual(['https://example.com/guide.xml']);
        expect(playlist.detectedEpgUrls).toEqual([
            'https://example.com/guide.xml',
        ]);
    });

    it('keeps large detected EPG lists separate from the auto-imported playlist EPG subset', () => {
        const playlist = createPlaylistObject('Playlist with global EPG list', {
            header: {
                attrs: {
                    'x-tvg-url': [
                        'https://iptv-org.github.io/epg/guides/us/tvguide.com.epg.xml',
                        'https://iptv-org.github.io/epg/guides/de/hd-plus.de.epg.xml',
                        'https://iptv-org.github.io/epg/guides/ua/example.ua.epg.xml',
                        'https://iptv-org.github.io/epg/guides/ru/tv.yandex.ru.epg.xml',
                        'https://iptv-org.github.io/epg/guides/fr/programme-tv.net.epg.xml',
                        'https://iptv-org.github.io/epg/guides/uk/sky.com.epg.xml',
                    ].join(','),
                },
                raw: '#EXTM3U',
            },
            items: [
                {
                    name: '1+1',
                    tvg: {
                        id: '1Plus1.ua',
                        name: '1+1',
                        url: '',
                        logo: '',
                        rec: '',
                    },
                    group: { title: 'Undefined' },
                    http: { referrer: '', 'user-agent': '' },
                    raw: '#EXTINF:-1 tvg-id="1Plus1.ua" tvg-country="RU;UA" tvg-language="Ukrainian",1+1',
                    url: 'https://example.com/stream.m3u8',
                },
            ],
        });

        expect(playlist.detectedEpgUrls).toHaveLength(6);
        expect(playlist.epgUrls).toEqual([
            'https://iptv-org.github.io/epg/guides/ua/example.ua.epg.xml',
            'https://iptv-org.github.io/epg/guides/ru/tv.yandex.ru.epg.xml',
        ]);
    });

    it('falls back to the first detected EPG URLs when a large list has no region recommendation match', () => {
        const epgUrls = [
            'https://provider.example.com/epg/source-1.xml',
            'https://provider.example.com/epg/source-2.xml',
            'https://provider.example.com/epg/source-3.xml',
            'https://provider.example.com/epg/source-4.xml',
            'https://provider.example.com/epg/source-5.xml',
            'https://provider.example.com/epg/source-6.xml',
        ];
        const playlist = createPlaylistObject(
            'Playlist with generic EPG list',
            {
                header: {
                    attrs: {
                        'x-tvg-url': epgUrls.join(','),
                    },
                    raw: '#EXTM3U',
                },
                items: [
                    {
                        name: 'Generic Channel',
                        tvg: {
                            id: 'generic-channel',
                            name: 'Generic Channel',
                            url: '',
                            logo: '',
                            rec: '',
                        },
                        group: { title: 'Undefined' },
                        http: { referrer: '', 'user-agent': '' },
                        raw: '#EXTINF:-1 tvg-id="generic-channel",Generic Channel',
                        url: 'https://example.com/stream.m3u8',
                    },
                ],
            }
        );

        expect(playlist.detectedEpgUrls).toEqual(epgUrls);
        expect(playlist.epgUrls).toEqual(epgUrls.slice(0, 5));
    });

    it('keeps disabled playlist EPG sources out while preserving manually enabled URLs', () => {
        expect(
            resolvePlaylistEpgSourceState({
                detectedEpgUrls: [
                    'https://playlist.example.com/auto.xml',
                    'https://playlist.example.com/disabled.xml',
                ],
                enabledEpgUrls: [
                    'https://playlist.example.com/auto.xml',
                    'https://playlist.example.com/disabled.xml',
                ],
                manualEpgUrls: [
                    ' https://playlist.example.com/manual.xml ',
                    'https://playlist.example.com/auto.xml',
                ],
                disabledEpgUrls: [
                    'https://playlist.example.com/disabled.xml',
                    '',
                    'https://playlist.example.com/disabled.xml',
                ],
            })
        ).toEqual({
            detectedEpgUrls: [
                'https://playlist.example.com/auto.xml',
                'https://playlist.example.com/disabled.xml',
            ],
            epgUrls: [
                'https://playlist.example.com/auto.xml',
                'https://playlist.example.com/manual.xml',
            ],
            manualEpgUrls: [
                'https://playlist.example.com/manual.xml',
                'https://playlist.example.com/auto.xml',
            ],
            disabledEpgUrls: ['https://playlist.example.com/disabled.xml'],
        });
    });

    it('filters playlist EPG fetch URLs that are already configured globally', () => {
        expect(
            filterPlaylistEpgUrlsForFetch(
                [
                    'https://global.example.com/guide.xml',
                    'https://playlist.example.com/local.xml',
                    ' https://playlist.example.com/local.xml ',
                ],
                [
                    ' https://global.example.com/guide.xml ',
                    'https://global.example.com/other.xml',
                ]
            )
        ).toEqual(['https://playlist.example.com/local.xml']);
    });
});
