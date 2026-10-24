import { Channel } from '@iptvnator/shared/interfaces';
import { exactEpgNameAliasesRevision, getChannelEpgAliasKey, replaceExactEpgNameAliases, resolveChannelEpgLookupKey } from './channel-epg-lookup.util';

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
    beforeEach(() => replaceExactEpgNameAliases(new Map()));
    afterEach(() => replaceExactEpgNameAliases(new Map()));
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
    it('publishes an alias change only when an actual lookup changes', () => {
        const channel = buildChannel();
        const initial = exactEpgNameAliasesRevision();
        replaceExactEpgNameAliases(new Map([[getChannelEpgAliasKey(channel), 'bbc.earth']]));
        expect(resolveChannelEpgLookupKey(channel)).toBe('bbc.earth');
        expect(exactEpgNameAliasesRevision()).toBe(initial + 1);
        replaceExactEpgNameAliases(new Map([[getChannelEpgAliasKey(channel), 'bbc.earth']]));
        expect(exactEpgNameAliasesRevision()).toBe(initial + 1);
        replaceExactEpgNameAliases(new Map([[getChannelEpgAliasKey(channel), 'beinsports.1']]));
        expect(resolveChannelEpgLookupKey(channel)).toBe('beinsports.1');
        expect(exactEpgNameAliasesRevision()).toBe(initial + 2);
    });

    it('keeps automatic matches separate for a shared tvg-id', () => {
        const hd = buildChannel({ id: 'hd', name: 'A2 HD' });
        const uhd = buildChannel({ id: 'uhd', name: 'A2 UHD' });
        replaceExactEpgNameAliases(new Map([
            [getChannelEpgAliasKey(hd), 'guide.hd'],
            [getChannelEpgAliasKey(uhd), 'guide.uhd'],
        ]));
        expect(resolveChannelEpgLookupKey(hd)).toBe('guide.hd');
        expect(resolveChannelEpgLookupKey(uhd)).toBe('guide.uhd');
        expect(resolveChannelEpgLookupKey(buildChannel({ id: 'other' }))).toBe('epg-id');
    });

    it('resolves cloned channel data to the same alias', () => {
        const channel = buildChannel();
        replaceExactEpgNameAliases(new Map([
            [getChannelEpgAliasKey(channel), 'guide.a2'],
        ]));
        expect(resolveChannelEpgLookupKey({ ...channel, tvg: { ...channel.tvg } })).toBe('guide.a2');
    });

});
