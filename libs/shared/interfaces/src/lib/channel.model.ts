import { Channel } from './channel.interface';

/**
 * Creates new channel object based on the given fields
 * @param params partial channel object
 */
export function createChannel(params: Partial<Channel>): Channel {
    return {
        id: params?.id || params.url,
        name: params.name,
        group: params.group,
        url: params.url,
        tvg: params.tvg,
        timeshift: params.timeshift,
        catchup: params.catchup,
        http: params.http,
        radio: params.radio,
    } as Channel;
}

/** Possible sidebar view options */
export type SidebarView = 'CHANNELS' | 'PLAYLISTS';
