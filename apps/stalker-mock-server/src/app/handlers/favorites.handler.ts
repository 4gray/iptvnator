import { Request, Response } from 'express';
import {
    addFavorite,
    getFavorites,
    getPortalData,
    removeFavorite,
} from '../data-store.js';
import { extractMac } from '../request-mac.js';
import {
    RawChannel,
    RawRadioStation,
    RawSeriesItem,
    RawVodItem,
} from '../data-generator.js';

/**
 * Stalker favorites endpoint.
 *
 * Query params:
 *   action: favorites
 *   fav_action: get | add | remove (some portals use set/unset)
 *   item_id: the item id to add/remove
 *   type: itv | vod | series | radio
 */
export function handleFavorites(req: Request, res: Response): void {
    const mac = extractMac(req);
    const favAction = (req.query['fav_action'] as string) ?? 'get';
    const itemId = req.query['item_id'] as string;

    if (favAction === 'add' || favAction === 'set') {
        if (itemId) addFavorite(mac, itemId);
        res.json({ js: { error: '' } });
        return;
    }

    if (favAction === 'remove' || favAction === 'unset') {
        if (itemId) removeFavorite(mac, itemId);
        res.json({ js: { error: '' } });
        return;
    }

    // fav_action === 'get' — return all favorited items
    const favIds = getFavorites(mac);
    const data = getPortalData(mac);

    type AnyItem = RawChannel | RawRadioStation | RawVodItem | RawSeriesItem;
    const result: AnyItem[] = [];

    for (const id of favIds) {
        // Search across all content types
        const found = findItemById(data, id);
        if (found) result.push(found);
    }

    res.json({
        js: {
            data: result,
            total_items: result.length,
        },
    });
}

function findItemById(
    data: ReturnType<typeof getPortalData>,
    id: string
): RawChannel | RawRadioStation | RawVodItem | RawSeriesItem | undefined {
    for (const items of data.channels.values()) {
        const found = items.find((i) => i.id === id);
        if (found) return found;
    }
    for (const items of data.radio.values()) {
        const found = items.find((i) => i.id === id);
        if (found) return found;
    }
    for (const items of data.vod.values()) {
        const found = items.find((i) => i.id === id);
        if (found) return found;
    }
    for (const items of data.series.values()) {
        const found = items.find((i) => i.id === id);
        if (found) return found;
    }
    return undefined;
}
