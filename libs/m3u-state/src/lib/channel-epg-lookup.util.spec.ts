import { Channel } from '@iptvnator/shared/interfaces';
import { resolveChannelEpgLookupKey } from './channel-epg-lookup.util';

function buildChannel(overrides: Partial<Channel> = {}): Channel {
    return {
        id: 'channel-1',
        url: 'https://example.com/live.m3u8',
        name: 'Fallback Name',
        group: { title: 'News' },
        tvg: {
            id: 'epg-id',
            name: 'Guide Name',
            url: '',
            logo: '',
            rec: '',
        },
        http: {
            referrer: '',
            'user-agent': '',
            origin: '',
        },
        radio: 'false',
        ...overrides,
    };
}

describe('resolveChannelEpgLookupKey', () => {
    it('prefers tvg id when present', () => {
        expect(resolveChannelEpgLookupKey(buildChannel())).toBe('epg-id');
    });

    it('falls back to tvg name before channel name', () => {
        expect(
            resolveChannelEpgLookupKey(
                buildChannel({
                    tvg: {
                        id: '   ',
                        name: 'Guide Name',
                        url: '',
                        logo: '',
                        rec: '',
                    },
                    name: 'Channel Name',
                })
            )
        ).toBe('Guide Name');
    });

    it('falls back to channel name when tvg fields are empty', () => {
        expect(
            resolveChannelEpgLookupKey(
                buildChannel({
                    tvg: {
                        id: ' ',
                        name: ' ',
                        url: '',
                        logo: '',
                        rec: '',
                    },
                    name: 'Channel Name',
                })
            )
        ).toBe('Channel Name');
    });
});
