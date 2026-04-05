import { Request, Response } from 'express';
import { getShortEpgListings } from '../data-store.js';

export function handleGetShortEpg(req: Request, res: Response): void {
    const {
        username = '',
        password = '',
        stream_id,
        limit,
    } = req.query as Record<string, string>;
    if (!stream_id) {
        res.json({ epg_listings: [] });
        return;
    }
    const id = parseInt(stream_id, 10);
    const limitNum = limit ? Math.min(parseInt(limit, 10), 50) : 12;
    const listings = getShortEpgListings(username, password, id, limitNum);
    res.json({ epg_listings: listings });
}
