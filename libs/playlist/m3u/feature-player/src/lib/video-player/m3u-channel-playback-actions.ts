import { ChannelActions } from '@iptvnator/m3u-state';
import { Channel } from '@iptvnator/shared/interfaces';

export function createM3uChannelPlaybackRequest(channel: Channel) {
    return ChannelActions.setActiveChannel({
        channel,
        startPlayback: true,
    });
}
