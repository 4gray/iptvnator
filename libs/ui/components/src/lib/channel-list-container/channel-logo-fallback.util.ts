import { resolveChannelEpgLookupKey } from '@iptvnator/m3u-state';
import { Channel } from '@iptvnator/shared/interfaces';

export function resolveChannelLogo(
    channel: Channel | null | undefined,
    channelIconMap: ReadonlyMap<string, string | null | undefined>
): string {
    const playlistLogo = channel?.tvg?.logo?.trim();
    if (playlistLogo) {
        return playlistLogo;
    }

    const channelId = resolveChannelEpgLookupKey(channel);
    const epgIcon = channelId ? channelIconMap.get(channelId)?.trim() : '';

    return epgIcon || '';
}
