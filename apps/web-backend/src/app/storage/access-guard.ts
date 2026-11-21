import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { SERVER_ACCESS_CHALLENGE } from '@iptvnator/shared/interfaces';
import { hostedLanOrigin, isHostedWorkerRequest } from '../hosted-ingress';

/** Routes a browser must reach before it has a token. */
const PUBLIC_PATHS = new Set(['/', '/health', '/config.js', '/v1/instance']);

/**
 * Optional shared-token protection for every other route, including the
 * provider proxy routes. Tokens are compared as SHA-256 digests so the
 * comparison is constant-time regardless of length.
 */
export function createAccessGuard(
    token: string,
    acceptsDevice?: (token: string) => boolean,
    cloudflareAccess?: import('../cloudflare-access').CloudflareAccessCheck,
    hostedMode?: 'lan' | 'https' | 'proxy' | 'cloudflare',
    openLan = false
): RequestHandler {
    const expected = digest(token);

    return async (req, res, next) => {
        if (req.method === 'OPTIONS' || PUBLIC_PATHS.has(req.path)) {
            next();
            return;
        }
        const token = readBearerToken(req.get('authorization'));
        if (
            token &&
            ((!hostedMode && timingSafeEqual(digest(token), expected)) ||
                acceptsDevice?.(token))
        ) {
            next();
            return;
        }

        if (
            isHostedWorkerRequest(req) ||
            (openLan &&
                hostedLanOrigin(req) &&
                isViewerRequest(req.method, req.path)) ||
            (await cloudflareAccess?.(req))
        ) {
            next();
            return;
        }

        res.status(401)
            .set('WWW-Authenticate', SERVER_ACCESS_CHALLENGE)
            .set('Access-Control-Expose-Headers', 'WWW-Authenticate')
            .json({
                message: 'This IPTVnator server requires an access token.',
                status: 401,
                code: 'unauthorized',
            });
    };
}

function isViewerRequest(method: string, path: string): boolean {
    if (method === 'GET' || method === 'HEAD') {
        return (
            /^\/v1\/(sources|playlists|favorites|history|activity|user-state|app-state)(\/|$)/.test(
                path
            ) || ['/xtream', '/stalker', '/parse', '/parse-xml'].includes(path)
        );
    }
    return (
        method === 'POST' &&
        [
            '/provider-targets',
            '/v1/favorites/read',
            '/v1/activity/read',
        ].includes(path)
    );
}

/**
 * `Bearer <token>`, scheme case-insensitive. Plain string scanning instead
 * of a regular expression keeps the cost linear in the header length.
 */
export function readBearerToken(header: string | undefined): string | null {
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

export function matchesAccessToken(
    header: string | undefined,
    expected: string
): boolean {
    const token = readBearerToken(header);
    return !!token && timingSafeEqual(digest(token), digest(expected));
}
