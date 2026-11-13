import type { Channel } from '@iptvnator/shared/interfaces';
import { m3uMultiviewChannelItem } from './m3u-multiview-channel';

describe('m3uMultiviewChannelItem', () => {
    const playlist = { _id: 'list-1', title: 'Synthetic List' };
    const channel = {
        id: 'c1',
        url: 'https://stream.example/c1.m3u8',
        name: 'Synthetic Channel 1',
        tvg: { id: 'syn.1', logo: 'https://logo.example/c1.png' },
        group: { title: 'News' },
    } as unknown as Channel;

    it('maps a row the way the M3U player keys its channel', () => {
        expect(m3uMultiviewChannelItem(playlist, channel)).toMatchObject({
            uid: 'm3u::list-1::c1',
            sourceType: 'm3u',
            contentType: 'live',
            playlistId: 'list-1',
            channelId: 'c1',
            streamUrl: 'https://stream.example/c1.m3u8',
            m3uChannel: channel,
        });
    });

    it('maps nothing without an active playlist or a stream URL', () => {
        expect(m3uMultiviewChannelItem(null, channel)).toBeNull();
        expect(
            m3uMultiviewChannelItem(playlist, { ...channel, url: '' })
        ).toBeNull();
    });
});
