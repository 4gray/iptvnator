import { Request, Response } from 'express';
import { getEpgListings } from '../data-store.js';

export function handleGetShortEpg(req: Request, res: Response): void {
    const { stream_id, limit } = req.query as Record<string, string>;
    if (!stream_id) {
        res.json({ epg_listings: [] });
        return;
    }
    const id = parseInt(stream_id, 10);
    const limitNum = limit ? Math.min(parseInt(limit, 10), 50) : 12;
    const listings = getEpgListings(id).slice(0, limitNum);
    res.json({ epg_listings: listings });
}
