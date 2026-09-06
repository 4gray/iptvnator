import { Channel } from '@iptvnator/shared/interfaces';
import { isSameChannelEntry } from './channel-entry-identity.util';

function entry(overrides: Partial<Channel> = {}): Channel {
    return {
        id: 'dup',
        url: 'https://example.com/dup.m3u8',
        name: 'Dup',
        group: { title: 'News' },
        tvg: { id: '', name: '', url: '', logo: '', rec: '' },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: 'false',
        epgParams: '',
        ...overrides,
    } as Channel;
}

describe('isSameChannelEntry', () => {
    it('treats spread copies with a rewritten epgParams as the same entry', () => {
        const a = entry();
        expect(isSameChannelEntry(a, { ...a, epgParams: 'x' })).toBe(true);
    });

    it('ignores key order', () => {
        const a = entry();
        const reordered = JSON.parse(JSON.stringify(a)) as Channel;
        expect(isSameChannelEntry(a, reordered)).toBe(true);
    });

    it('tells entries apart by playback headers, logo or group', () => {
        const a = entry();
        expect(
            isSameChannelEntry(
                a,
                entry({
                    http: { referrer: '', 'user-agent': 'VLC', origin: '' },
                })
            )
        ).toBe(false);
        expect(
            isSameChannelEntry(
                a,
                entry({ tvg: { ...a.tvg, logo: 'https://x/logo.png' } })
            )
        ).toBe(false);
        expect(
            isSameChannelEntry(a, entry({ group: { title: 'Sports' } }))
        ).toBe(false);
    });
});
