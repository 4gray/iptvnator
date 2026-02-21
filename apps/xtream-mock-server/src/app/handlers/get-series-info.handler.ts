import { Request, Response } from 'express';
import { getSeriesInfo } from '../data-store.js';

export function handleGetSeriesInfo(req: Request, res: Response): void {
    const { username = '', password = '', series_id } = req.query as Record<string, string>;
    if (!series_id) {
        res.status(400).json({ error: 'series_id required' });
        return;
    }
    const info = getSeriesInfo(username, password, parseInt(series_id, 10));
    if (!info) {
        res.status(404).json({ error: 'Series not found' });
        return;
    }
    res.json(info);
}
