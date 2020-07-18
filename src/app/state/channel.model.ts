import { ID, guid } from '@datorama/akita';

/**
 * Represents channel object
 * TODO: define channel interface in iptv-parser library
 */
export interface Channel {
    id: string;
    url: string;
    name: string;
    group: {
        title: string;
    };
    fav: boolean;
}

/**
 * Creates new channel object based on the given fields
 * @param params partial channel object
 */
export function createChannel(
    params: Partial<Channel>,
    favoritesList: string[]
) {
    return {
        id: params.url,
        name: params.name,
        group: params.group,
        url: params.url,
        fav: favoritesList.includes(params.url),
    } as Channel;
}
