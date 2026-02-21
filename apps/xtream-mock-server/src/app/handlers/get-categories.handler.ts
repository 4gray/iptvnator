import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';

export function handleGetLiveCategories(req: Request, res: Response): void {
    const { username = '', password = '' } = req.query as Record<string, string>;
    const { liveCategories } = getPortalData(username, password);
    res.json(liveCategories);
}

export function handleGetVodCategories(req: Request, res: Response): void {
    const { username = '', password = '' } = req.query as Record<string, string>;
    const { vodCategories } = getPortalData(username, password);
    res.json(vodCategories);
}

export function handleGetSeriesCategories(req: Request, res: Response): void {
    const { username = '', password = '' } = req.query as Record<string, string>;
    const { seriesCategories } = getPortalData(username, password);
    res.json(seriesCategories);
}
