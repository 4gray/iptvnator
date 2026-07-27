import { Request, Response } from 'express';
import { getPortalData } from '../data-store.js';
import { getScenario } from '../scenarios.js';
import { extractMac } from './get-categories.handler.js';

/**
 * Stalker/Ministra get_all_channels — returns the COMPLETE ITV channel list
 * in a single response (no pagination). This is what STB clients use to build
 * their local channel list.
 *
 * Only type=itv is supported, matching the reference Ministra middleware.
 * Scenarios with supportsGetAllChannels=false mimic legacy portals and answer
 * with an error payload so clients fall back to paginated get_ordered_list.
 */
export function handleGetAllChannels(req: Request, res: Response): void {
    const mac = extractMac(req);
    const type = (req.query['type'] as string) ?? 'itv';
    const scenario = getScenario(mac);

    if (scenario.supportsGetAllChannels === false || type !== 'itv') {
        res.json({ js: { error: 'Unknown action: get_all_channels' } });
        return;
    }

    const data = getPortalData(mac);
    // Like real Ministra portals: censored (adult) genres are excluded from
    // the bulk channel list — clients must page those genres explicitly.
    const censoredIds = new Set(
        data.itvCategories
            .filter((cat) => cat.censored === '1')
            .map((cat) => cat.id)
    );
    const allChannels = [...data.channels.entries()]
        .filter(([categoryId]) => !censoredIds.has(categoryId))
        .flatMap(([, channels]) => channels);

    res.json({
        js: {
            data: allChannels,
            total_items: allChannels.length,
            max_page_items: allChannels.length,
            cur_page: 0,
            selected_item: 0,
        },
    });
}
