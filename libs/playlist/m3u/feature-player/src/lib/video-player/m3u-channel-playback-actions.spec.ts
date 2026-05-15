import { ChannelActions } from '@iptvnator/m3u-state';
import { Channel } from '@iptvnator/shared/interfaces';
import { createM3uChannelPlaybackRequest } from './m3u-channel-playback-actions';

describe('createM3uChannelPlaybackRequest', () => {
    it('marks channel activation as an explicit playback request', () => {
        const channel = {
            id: 'channel-1',
            name: 'Sample TV',
            url: 'http://localhost/live.m3u8',
        } as Channel;

        expect(createM3uChannelPlaybackRequest(channel)).toEqual(
            ChannelActions.setActiveChannel({
                channel,
                startPlayback: true,
            })
        );
    });
});
