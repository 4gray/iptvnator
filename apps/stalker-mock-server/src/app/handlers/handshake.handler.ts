import { Request, Response } from 'express';
import { issueHandshakeToken } from '../auth-store.js';

/**
 * Stalker handshake — issues the access token.
 *
 * Like the real middleware the token is opaque and idempotent: presenting the
 * MAC's current token returns it unchanged instead of rotating it. `random` is
 * the 5.x nonce a real MAG signs into `signature`; the mock returns it so
 * clients that read it are exercised.
 */
export function handleHandshake(req: Request, res: Response): void {
    const mac = (req.headers['cookie'] ?? '')
        .split(';')
        .find((c) => c.trim().startsWith('mac='))
        ?.split('=')[1]
        ?.trim() ?? 'unknown';

    const presented = String(req.query['token'] ?? '') || undefined;
    const { token, notValid } = issueHandshakeToken(mac, presented);

    res.json({
        js: {
            token,
            random: `${token.slice(0, 20).toLowerCase()}0123456789abcdef1234`,
            not_valid: notValid ? 1 : 0,
            keep_alive: 180,
            servertime: Math.floor(Date.now() / 1000),
            servertimezone: 'Europe/Berlin',
            version: '5.6.2',
            revision: '1',
        },
    });
}
