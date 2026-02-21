import { Request, Response } from 'express';
import { generateEpg } from '../data-generator.js';
import { getPortalData } from '../data-store.js';
import { extractMac } from './get-categories.handler.js';

/**
 * Stalker get_short_epg — returns EPG programs for a channel.
 *
 * Query params:
 *   ch_id: channel id
 *   size:  number of programs to return (default 12)
 */
export function handleGetShortEpg(req: Request, res: Response): void {
    const mac = extractMac(req);
    const channelId = req.query['ch_id'] as string;
    const size = parseInt((req.query['size'] as string) ?? '12', 10);
    const data = getPortalData(mac);

    let programs = data.epg.get(channelId);

    if (!programs) {
        // Channel not found — generate on-the-fly
        programs = generateEpg(`Channel ${channelId}`);
        data.epg.set(channelId, programs);
    }

    res.json({
        js: {
            data: programs.slice(0, size),
        },
    });
}
