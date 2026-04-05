import { Request, Response } from 'express';
import { getEpgListings } from '../data-store.js';

export function handleGetFullEpg(req: Request, res: Response): void {
    const {
        username = '',
        password = '',
        stream_id,
    } = req.query as Record<string, string>;
    if (!stream_id) {
        res.json({ epg_listings: [] });
        return;
    }

    const id = parseInt(stream_id, 10);
    res.json({ epg_listings: getEpgListings(username, password, id) });
}
