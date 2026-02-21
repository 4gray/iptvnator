import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';
import { extractMac } from './get-categories.handler.js';

/**
 * Stalker get_genres — returns genre list for a content type.
 * Genres mirror the categories for our mock portal.
 */
export function handleGetGenres(req: Request, res: Response): void {
    const mac = extractMac(req);
    const type = (req.query['type'] as string) ?? 'vod';
    const data = getPortalData(mac);

    let categories;
    if (type === 'itv') {
        categories = data.itvCategories;
    } else if (type === 'series') {
        categories = data.seriesCategories;
    } else {
        categories = data.vodCategories;
    }

    const genres = categories.map((cat) => ({
        id: cat.id,
        title: cat.title,
        alias: cat.alias,
        censored: '0',
    }));

    res.json({ js: genres });
}
