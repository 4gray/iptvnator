import { Request } from 'express';

/**
 * Read the MAC the portal identifies the box by. Real Stalker clients send it
 * as a `mac=` cookie on every request; the proxy route synthesizes the same
 * cookie from its query parameter.
 */
export function extractMac(req: Request): string {
    const cookie = req.headers['cookie'] ?? '';
    return (
        cookie
            .split(';')
            .find((c) => c.trim().startsWith('mac='))
            ?.split('=')[1]
            ?.trim() ?? '00:00:00:00:00:00'
    );
}
