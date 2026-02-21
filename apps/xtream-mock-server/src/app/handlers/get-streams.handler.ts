import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';

export function handleGetLiveStreams(req: Request, res: Response): void {
    const { username = '', password = '', category_id } = req.query as Record<string, string>;
    let { liveStreams } = getPortalData(username, password);
    if (category_id) {
        liveStreams = liveStreams.filter(s => String(s.category_id) === category_id);
    }
    res.json(liveStreams);
}

export function handleGetVodStreams(req: Request, res: Response): void {
    const { username = '', password = '', category_id } = req.query as Record<string, string>;
    let { vodStreams } = getPortalData(username, password);
    if (category_id) {
        vodStreams = vodStreams.filter(s => String(s.category_id) === category_id);
    }
    res.json(vodStreams);
}

export function handleGetSeriesStreams(req: Request, res: Response): void {
    const { username = '', password = '', category_id } = req.query as Record<string, string>;
    let { seriesItems } = getPortalData(username, password);
    if (category_id) {
        seriesItems = seriesItems.filter(s => String(s.category_id) === category_id);
    }
    res.json(seriesItems);
}
