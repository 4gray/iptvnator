import { StalkerVodSource } from './stalker-favorite-item.interface';

/**
 * Generic content item returned by Stalker category content endpoints.
 * Used for VOD, series, and ITV category lists.
 */
export interface StalkerContentItem extends StalkerVodSource {
    cover?: string;
}
