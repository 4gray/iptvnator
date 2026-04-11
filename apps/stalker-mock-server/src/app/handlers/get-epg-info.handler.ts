import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';
import { extractMac } from './get-categories.handler.js';

/**
 * Stalker get_epg_info — returns bulk EPG keyed by channel id.
 *
 * Query params:
 *   period: number of future hours to include (default 168)
 */
export function handleGetEpgInfo(req: Request, res: Response): void {
    const mac = extractMac(req);
    const period = parseInt((req.query['period'] as string) ?? '168', 10);
    const data = getPortalData(mac);
    const now = Math.floor(Date.now() / 1000);
    const currentDayStart = new Date();
    currentDayStart.setUTCHours(0, 0, 0, 0);
    const startTimestamp = Math.floor(currentDayStart.getTime() / 1000);
    const endTimestamp = now + Math.max(period, 1) * 60 * 60;

    const epgByChannel = Object.fromEntries(
        [...data.epg.entries()].map(([channelId, programs]) => [
            channelId,
            programs.filter(
                (program) =>
                    program.stop_timestamp >= startTimestamp &&
                    program.start_timestamp <= endTimestamp
            ),
        ])
    );

    res.json({
        js: {
            data: epgByChannel,
        },
    });
}
