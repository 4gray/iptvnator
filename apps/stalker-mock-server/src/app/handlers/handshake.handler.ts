import { Request, Response } from 'express';

/**
 * Stalker handshake — returns a Bearer token.
 * Real portals return a JWT; we return a deterministic fake token.
 */
export function handleHandshake(req: Request, res: Response): void {
    const mac = (req.headers['cookie'] ?? '')
        .split(';')
        .find((c) => c.trim().startsWith('mac='))
        ?.split('=')[1]
        ?.trim() ?? 'unknown';

    res.json({
        js: {
            token: `mock-token-${Buffer.from(mac).toString('base64')}`,
            keep_alive: 180,
            servertime: Math.floor(Date.now() / 1000),
            servertimezone: 'Europe/Berlin',
            version: '5.6.2',
            revision: '1',
        },
    });
}
