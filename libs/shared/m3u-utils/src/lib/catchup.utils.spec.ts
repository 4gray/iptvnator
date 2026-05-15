import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    getM3uArchiveDays,
    isM3uCatchupPlaybackSupported,
    resolveM3uCatchupUrl,
} from './catchup.utils';
import { createPlaylistObject } from './playlist.utils';

describe('catchup.utils', () => {
    const baseChannel: Channel = {
        id: 'channel-1',
        name: 'News One',
        url: 'https://streams.example.com/live/channel-1.m3u8',
        group: { title: 'News' },
        tvg: {
            id: 'news-1',
            name: 'News One',
            url: '',
            logo: '',
            rec: '3',
        },
        catchup: {
            type: 'shift',
            days: '3',
        },
        timeshift: '3',
        http: {
            referrer: '',
            'user-agent': '',
            origin: '',
        },
        radio: 'false',
        epgParams: '',
    };

    const archivedProgram: EpgProgram = {
        start: '2026-04-10T08:00:00.000Z',
        stop: '2026-04-10T09:00:00.000Z',
        channel: 'news-1',
        title: 'Morning News',
        desc: null,
        category: null,
        startTimestamp: 1_775_808_800,
        stopTimestamp: 1_775_812_400,
    };

    it('reports archive days from catchup metadata before legacy fields', () => {
        expect(
            getM3uArchiveDays({
                ...baseChannel,
                catchup: { type: 'shift', days: '5' },
                timeshift: '3',
                tvg: { ...baseChannel.tvg, rec: '2' },
            })
        ).toBe(5);
    });

    it('falls back to tvg-rec when catchup-days and timeshift are blank strings', () => {
        expect(
            getM3uArchiveDays({
                ...baseChannel,
                catchup: { type: '', days: '' },
                timeshift: '',
                tvg: { ...baseChannel.tvg, rec: '7' },
            })
        ).toBe(7);
    });

    it('supports legacy same-stream shift playback when catchup type is shift', () => {
        expect(isM3uCatchupPlaybackSupported(baseChannel)).toBe(true);
        expect(resolveM3uCatchupUrl(baseChannel, archivedProgram, 1_775_820_000))
            .toBe(
                'https://streams.example.com/live/channel-1.m3u8?utc=1775808800&lutc=1775820000'
            );
    });

    it('supports tvg-rec-only legacy same-stream playback when the channel url is reusable', () => {
        const channel: Channel = {
            ...baseChannel,
            tvg: {
                ...baseChannel.tvg,
                rec: '7',
            },
            catchup: undefined,
            timeshift: undefined,
        };

        expect(isM3uCatchupPlaybackSupported(channel)).toBe(true);
        expect(resolveM3uCatchupUrl(channel, archivedProgram, 1_775_820_000))
            .toBe(
                'https://streams.example.com/live/channel-1.m3u8?utc=1775808800&lutc=1775820000'
            );
    });

    it('rewrites utc and lutc query params on catchup-source urls', () => {
        const playbackUrl = resolveM3uCatchupUrl(
            {
                ...baseChannel,
                catchup: {
                    type: 'append',
                    days: '3',
                    source:
                        'https://archive.example.com/catchup.m3u8?utc=1&lutc=2&token=abc',
                },
            },
            archivedProgram,
            1_775_820_000
        );

        expect(playbackUrl).toBe(
            'https://archive.example.com/catchup.m3u8?utc=1775808800&lutc=1775820000&token=abc'
        );
    });

    it('returns null when the channel metadata declares an unsupported replay scheme', () => {
        expect(
            isM3uCatchupPlaybackSupported({
                ...baseChannel,
                catchup: {
                    type: 'append',
                    days: '3',
                    source: '',
                },
                timeshift: '3',
            })
        ).toBe(false);
        expect(
            resolveM3uCatchupUrl(
                {
                    ...baseChannel,
                    catchup: {
                        type: 'append',
                        days: '3',
                        source: '',
                    },
                    timeshift: '3',
                },
                archivedProgram
            )
        ).toBeNull();
    });

    it('returns null for tvg-rec-only channels when the stream url is not http', () => {
        expect(
            isM3uCatchupPlaybackSupported({
                ...baseChannel,
                url: 'udp://239.0.0.1:1234',
                tvg: {
                    ...baseChannel.tvg,
                    rec: '7',
                },
                catchup: undefined,
                timeshift: undefined,
            })
        ).toBe(false);
        expect(
            resolveM3uCatchupUrl(
                {
                    ...baseChannel,
                    url: 'udp://239.0.0.1:1234',
                    tvg: {
                        ...baseChannel.tvg,
                        rec: '7',
                    },
                    catchup: undefined,
                    timeshift: undefined,
                },
                archivedProgram
            )
        ).toBeNull();
    });

    it('returns null when archive days are missing', () => {
        expect(
            resolveM3uCatchupUrl(
                {
                    ...baseChannel,
                    tvg: { ...baseChannel.tvg, rec: '' },
                    timeshift: '',
                    catchup: {
                        type: 'shift',
                        days: '',
                    },
                },
                archivedProgram
            )
        ).toBeNull();
    });

    it('falls back to parsing the program start string when the unix timestamp is unavailable', () => {
        expect(
            resolveM3uCatchupUrl(
                baseChannel,
                {
                    ...archivedProgram,
                    start: '202604100800 +0000',
                    startTimestamp: null,
                },
                1_775_820_000
            )
        ).toBe(
            'https://streams.example.com/live/channel-1.m3u8?utc=1775808000&lutc=1775820000'
        );
    });

    it('preserves catchup metadata when storing parsed playlist items', () => {
        const playlist = createPlaylistObject('Catchup playlist', {
            header: {
                attrs: {
                    'x-tvg-url': 'https://example.com/guide.xml',
                },
                raw: '#EXTM3U x-tvg-url="https://example.com/guide.xml"',
            },
            items: [
                {
                    name: 'News One',
                    tvg: {
                        id: 'news-1',
                        name: 'News One',
                        url: '',
                        logo: '',
                        rec: '3',
                    },
                    group: { title: 'News' },
                    http: {
                        referrer: '',
                        'user-agent': '',
                    },
                    url: 'https://streams.example.com/live/channel-1.m3u8',
                    raw: '#EXTINF:-1,News One',
                    catchup: {
                        type: 'shift',
                        source: 'https://archive.example.com/catchup.m3u8',
                        days: '3',
                    },
                    timeshift: '3',
                    radio: 'false',
                },
            ],
        });

        expect(playlist.playlist?.items[0]).toEqual(
            expect.objectContaining({
                catchup: {
                    type: 'shift',
                    source: 'https://archive.example.com/catchup.m3u8',
                    days: '3',
                },
                timeshift: '3',
                radio: 'false',
            })
        );
    });
});
