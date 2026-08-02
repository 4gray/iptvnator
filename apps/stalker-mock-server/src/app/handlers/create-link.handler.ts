import { Request, Response } from 'express';
import { resolveStreamUrl } from '../data-generator.js';
import { extractMac } from '../request-mac.js';

/**
 * Stalker create_link — returns a playable stream URL.
 *
 * Query params:
 *   cmd: the ffrt4:// or similar command from the content item
 *   type: itv | vod | series | radio
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
            // Mock-only diagnostics (absent from real portal responses): what
            // this request actually delivered after Express' single query
            // decode — the same view a PHP portal gets from $_GET. E2E uses
            // them to pin the cmd wire contract (no double-encoding, no
            // query-parameter injection through cmd).
            cmd_received: cmd,
            query_keys_received: Object.keys(req.query).sort(),
        },
    });
}
