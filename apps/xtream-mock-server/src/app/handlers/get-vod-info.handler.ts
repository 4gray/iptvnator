import { Request, Response } from 'express';
import { getVodDetails } from '../data-store.js';

export function handleGetVodInfo(req: Request, res: Response): void {
    const { username = '', password = '', vod_id } = req.query as Record<string, string>;
    if (!vod_id) {
        res.status(400).json({ error: 'vod_id required' });
        return;
    }
    const details = getVodDetails(username, password, parseInt(vod_id, 10));
    if (!details) {
        res.status(404).json({ error: 'VOD not found' });
        return;
    }
    res.json(details);
}
