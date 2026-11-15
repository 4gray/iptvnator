import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { listenHosted } from './hosted-listener';
import { closeGracefully } from './graceful-shutdown';
import { createWebBackendApp } from './web-backend-app';
import { generateKeyPairSync, sign } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { createCloudflareAccessCheck } from './cloudflare-access';
import { markHostedIngress } from './hosted-ingress';

describe('Cloudflare Access for hosted HTTPS', () => {
    function fixture() {
        const origin = 'https://library.example.test';
        const issuer = 'https://example-team.cloudflareaccess.com';
        const audience = 'a'.repeat(64);
        const { privateKey, publicKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
        });
        const fetchKeys = jest.fn(async () =>
            Response.json({
                keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'key' }],
            })
        );
        const check = createCloudflareAccessCheck(
            {
                IPTVNATOR_CLOUDFLARE_ACCESS_ORIGIN: origin,
                IPTVNATOR_CLOUDFLARE_ACCESS_TEAM: 'example-team',
                IPTVNATOR_CLOUDFLARE_ACCESS_AUDIENCE: audience,
            },
            fetchKeys
        )!;
        const now = Math.floor(Date.now() / 1000);
        const encode = (value: unknown) =>
            Buffer.from(JSON.stringify(value)).toString('base64url');
        const assertion = (claims: object = {}) => {
            const message = [
                encode({ alg: 'RS256', kid: 'key' }),
                encode({
                    iss: issuer,
                    aud: [audience],
                    type: 'app',
                    exp: now + 60,
                    ...claims,
                }),
            ].join('.');
            return (
                message +
                '.' +
                sign('RSA-SHA256', Buffer.from(message), privateKey).toString(
                    'base64url'
                )
            );
        };
        const mockRequest = (token: string, ingress?: string) => {
            const req = new IncomingMessage(new Socket());
            req.headers['cf-access-jwt-assertion'] = token;
            if (ingress) markHostedIngress(req, ingress);
            return req;
        };
        return { origin, fetchKeys, check, assertion, mockRequest, now };
    }

    it('accepts only a valid application assertion on the configured listener', async () => {
        const { origin, fetchKeys, check, assertion, mockRequest, now } =
            fixture();
        await expect(check(mockRequest(assertion()))).resolves.toBe(false);
        await expect(
            check(mockRequest(assertion(), 'https://other.example.test'))
        ).resolves.toBe(false);
        await expect(check(mockRequest('', origin))).resolves.toBe(false);
        await expect(
            check(mockRequest(assertion({ aud: ['wrong'] }), origin))
        ).resolves.toBe(false);
        await expect(
            check(mockRequest(assertion({ exp: now - 1 }), origin))
        ).resolves.toBe(false);
        await expect(
            check(
                mockRequest(
                    assertion({ iss: 'https://wrong.example.test' }),
                    origin
                )
            )
        ).resolves.toBe(false);
        await expect(
            check(
                mockRequest(assertion().replace(/\.[^.]+$/, '.invalid'), origin)
            )
        ).resolves.toBe(false);
        await expect(check(mockRequest(assertion(), origin))).resolves.toBe(
            true
        );
        expect(fetchKeys).toHaveBeenCalledTimes(1);
    });

    it('uses Access identity on the protected listener only', async () => {
        const { origin, fetchKeys, check, assertion } = fixture();
        const app = createWebBackendApp({
            accessToken: 'viewer-code',
            cloudflareAccess: check,
        });
        const local = await listenHosted(app, '127.0.0.1', 0);
        const remote = await listenHosted(app, '127.0.0.1', 0, new URL(origin));
        const get = (
            server: typeof local,
            path: string,
            headers: Record<string, string> = {}
        ) =>
            new Promise<{ status: number; auth?: string }>(
                (resolve, reject) => {
                    const req = request(
                        {
                            host: '127.0.0.1',
                            port: (server.address() as AddressInfo).port,
                            path,
                            headers: {
                                ...(server === remote
                                    ? { Host: new URL(origin).host }
                                    : {}),
                                ...headers,
                            },
                        },
                        (response) => {
                            let body = '';
                            response.setEncoding('utf8').on('data', (part) => {
                                body += part;
                            });
                            response.once('end', () =>
                                resolve({
                                    status: response.statusCode!,
                                    auth:
                                        path === '/v1/instance'
                                            ? JSON.parse(body).auth
                                            : undefined,
                                })
                            );
                        }
                    );
                    req.once('error', reject);
                    req.end();
                }
            );
        try {
            const signedIn = { 'Cf-Access-Jwt-Assertion': assertion() };
            expect(await get(remote, '/v1/instance', signedIn)).toEqual({
                status: 200,
                auth: 'none',
            });
            expect(await get(local, '/v1/instance', signedIn)).toEqual({
                status: 200,
                auth: 'token',
            });
            expect((await get(remote, '/provider-targets')).status).toBe(401);
            expect(
                (await get(remote, '/provider-targets', signedIn)).status
            ).toBe(404);
            expect(
                (await get(local, '/provider-targets', signedIn)).status
            ).toBe(401);
            expect(
                (
                    await get(local, '/provider-targets', {
                        Authorization: 'Bearer viewer-code',
                    })
                ).status
            ).toBe(404);
        } finally {
            await Promise.all([
                closeGracefully(local, 0),
                closeGracefully(remote, 0),
            ]);
        }
        expect(fetchKeys).toHaveBeenCalledTimes(1);
    });
});
