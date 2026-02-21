import { Request, Response } from 'express';
import { resolveStreamUrl } from '../data-generator.js';
import { extractMac } from './get-categories.handler.js';

/**
 * Stalker create_link — returns a playable stream URL.
 *
 * Query params:
 *   cmd: the ffrt4:// or similar command from the content item
 *   type: itv | vod | series
 */
export function handleCreateLink(req: Request, res: Response): void {
    const mac = extractMac(req);
    const cmd = (req.query['cmd'] as string) ?? '';

    // Use a stable index derived from the cmd string so the same item
    // always returns the same test stream URL.
    const itemIndex = cmd
        .split('')
        .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const streamUrl = resolveStreamUrl(cmd, itemIndex);

    console.log(`[create_link] MAC=${mac} cmd=${cmd} → ${streamUrl}`);

    res.json({
        js: {
            cmd: streamUrl,
            streamer_id: '1',
            load: '',
            error: '',
        },
    });
}
