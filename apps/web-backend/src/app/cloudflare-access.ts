import { createPublicKey, verify } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { hostedIngressOrigin } from './hosted-ingress';

export type CloudflareAccessCheck = (
    request: IncomingMessage
) => Promise<boolean>;

type SigningKey = Parameters<typeof createPublicKey>[0];
const KEY_CACHE_MS = 5 * 60_000;
const KEY_REFRESH_INTERVAL_MS = 30_000;

export function createCloudflareAccessCheck(
    env = process.env,
    fetchKeys = fetch
): CloudflareAccessCheck | undefined {
    const origin = env.IPTVNATOR_CLOUDFLARE_ACCESS_ORIGIN;
    const team = env.IPTVNATOR_CLOUDFLARE_ACCESS_TEAM;
    const audience = env.IPTVNATOR_CLOUDFLARE_ACCESS_AUDIENCE;
    if (!origin || !team || !audience) return undefined;
    if (!/^[a-z0-9-]{1,63}$/.test(team) || !/^[a-f0-9]{64}$/.test(audience))
        return undefined;

    const issuer = `https://${team}.cloudflareaccess.com`;
    let keys = new Map<string, SigningKey>();
    let expires = 0;
    let nextRefresh: number | undefined;
    let pending: Promise<void> | undefined;

    async function downloadKeys() {
        const response = await fetchKeys(`${issuer}/cdn-cgi/access/certs`, {
            redirect: 'error',
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error('Access keys unavailable');
        const jwks = (await response.json()) as {
            keys: Array<{ kid: string; kty: string; n: string; e: string }>;
        };
        keys = new Map(
            jwks.keys
                .filter((key) => key.kty === 'RSA')
                .map((key) => [key.kid, { key, format: 'jwk' } as const])
        );
        expires = Date.now() + KEY_CACHE_MS;
    }

    async function signingKey(kid: string) {
        const now = Date.now();
        const cached = keys.get(kid);
        if (cached && now < expires) return cached;
        if (!pending) {
            if (nextRefresh !== undefined && now < nextRefresh) return;
            // Permit one immediate retry after bootstrap, then limit refreshes across all key IDs.
            nextRefresh =
                nextRefresh === undefined ? now : now + KEY_REFRESH_INTERVAL_MS;
            pending = downloadKeys().finally(() => {
                pending = undefined;
            });
        }
        await pending;
        return keys.get(kid);
    }

    return async (request) => {
        if (hostedIngressOrigin(request) !== origin) return false;
        const token = request.headers['cf-access-jwt-assertion'];
        if (
            typeof token !== 'string' ||
            token.length > 16384 ||
            !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)
        )
            return false;

        try {
            const [header, payload, signature] = token.split('.');
            const { alg, kid } = JSON.parse(
                Buffer.from(header, 'base64url').toString()
            );
            const claims = JSON.parse(
                Buffer.from(payload, 'base64url').toString()
            );
            const now = Math.floor(Date.now() / 1000);
            if (
                alg !== 'RS256' ||
                typeof kid !== 'string' ||
                !kid ||
                claims.iss !== issuer ||
                claims.type !== 'app' ||
                !Array.isArray(claims.aud) ||
                !claims.aud.includes(audience) ||
                !Number.isSafeInteger(claims.exp) ||
                claims.exp <= now ||
                (claims.nbf !== undefined &&
                    (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))
            )
                return false;

            const key = await signingKey(kid);
            return (
                !!key &&
                verify(
                    'RSA-SHA256',
                    Buffer.from(`${header}.${payload}`),
                    createPublicKey(key),
                    Buffer.from(signature, 'base64url')
                )
            );
        } catch {
            return false;
        }
    };
}
