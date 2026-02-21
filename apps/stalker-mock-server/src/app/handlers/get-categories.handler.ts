import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';

/**
 * Stalker get_categories — returns category list filtered by type (itv/vod/series).
 */
export function handleGetCategories(req: Request, res: Response): void {
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

    res.json({ js: categories });
}

export function extractMac(req: Request): string {
    const cookie = req.headers['cookie'] ?? '';
    return (
        cookie
            .split(';')
            .find((c) => c.trim().startsWith('mac='))
            ?.split('=')[1]
            ?.trim() ?? '00:00:00:00:00:00'
    );
}
