import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Routes a browser must reach before it has a token. */
const PUBLIC_PATHS = new Set(['/', '/health', '/config.js', '/v1/instance']);

/**
 * Optional shared-token protection for every other route, including the
 * provider proxy routes. Tokens are compared as SHA-256 digests so the
 * comparison is constant-time regardless of length.
 */
export function createAccessGuard(token: string): RequestHandler {
    const expected = digest(token);

    return (req, res, next) => {
        if (req.method === 'OPTIONS' || PUBLIC_PATHS.has(req.path)) {
            next();
            return;
        }

        const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
        if (match && timingSafeEqual(digest(match[1].trim()), expected)) {
            next();
            return;
        }

        res.status(401).json({
            message: 'This IPTVnator server requires an access token.',
            status: 401,
            code: 'unauthorized',
        });
    };
}

function digest(value: string): Buffer {
    return createHash('sha256').update(value).digest();
}
