// should represent the content of a card element - xtream category or VOD or any item from stalker, vportal etc
export interface PortalCardItem {
    // TODO
    id: string;
    type: 'category' | 'vod' | 'serial' | 'live'; // TODO: enum
    name: string;
    coverUrl?: string;
    streamType?: 'live' | 'movie'; // TODO: maybe not needed, since type is there
    categoryId?: string;
}
