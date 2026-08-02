import { Request, Response } from 'express';
import { extractMac } from '../request-mac.js';

/** Per-MAC watchdog bookkeeping so tests can assert the client pings at all. */
const watchdogPings = new Map<string, { count: number; lastInit: string }>();

/**
 * Stalker watchdog `get_events`. The real portal only uses it for presence
 * reporting and event delivery — it never affects authorization — so the mock
 * records the ping and returns an empty event set.
 */
export function handleGetEvents(req: Request, res: Response): void {
    const mac = extractMac(req).toLowerCase();
    const init = String(req.query['init'] ?? '0');
    const previous = watchdogPings.get(mac);

    watchdogPings.set(mac, {
        count: (previous?.count ?? 0) + 1,
        lastInit: init,
    });

    res.json({
        js: {
            data: {
                msgs: 0,
                additional_services_on: '1',
            },
        },
    });
}

export function getWatchdogPings(
    mac: string
): { count: number; lastInit: string } | undefined {
    return watchdogPings.get(mac.toLowerCase());
}

export function resetWatchdogPings(mac?: string): void {
    if (mac) {
        watchdogPings.delete(mac.toLowerCase());
        return;
    }
    watchdogPings.clear();
}
