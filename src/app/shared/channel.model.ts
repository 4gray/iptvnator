import { Channel } from '../../../shared/channel.interface';

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
        http: params.http,
    } as Channel;
}
