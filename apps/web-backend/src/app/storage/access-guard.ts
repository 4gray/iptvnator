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

        const token = readBearerToken(req.get('authorization'));
        if (token && timingSafeEqual(digest(token), expected)) {
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

/**
 * `Bearer <token>`, scheme case-insensitive. Plain string scanning instead
 * of a regular expression keeps the cost linear in the header length.
 */
function readBearerToken(header: string | undefined): string | null {
    const value = header?.trim() ?? '';
    const separator = value.indexOf(' ');
    if (separator < 0 || value.slice(0, separator).toLowerCase() !== 'bearer') {
        return null;
    }
    const token = value.slice(separator + 1).trim();
    return token ? token : null;
}

function digest(value: string): Buffer {
    return createHash('sha256').update(value).digest();
}
