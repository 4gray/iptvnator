import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';
import { extractMac } from '../request-mac.js';

/**
 * Stalker get_categories — returns category list filtered by type.
 */
export function handleGetCategories(req: Request, res: Response): void {
    const mac = extractMac(req);
    const type = (req.query['type'] as string) ?? 'vod';
    const data = getPortalData(mac);

    let categories;
    if (type === 'itv') {
        categories = data.itvCategories;
    } else if (type === 'radio') {
        categories = data.radioCategories;
    } else if (type === 'series') {
        categories = data.seriesCategories;
    } else {
        categories = data.vodCategories;
    }

    res.json({ js: categories });
}
