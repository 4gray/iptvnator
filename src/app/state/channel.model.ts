import { ID, guid } from '@datorama/akita';

export interface Channel {
    id: ID;
    inf: any;
    url: string;
}

export function createChannel(params: Partial<Channel>) {
    return {
        id: guid(),
        inf: params.inf,
        url: params.url
    } as Channel;
}
