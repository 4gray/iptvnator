import { createServer, type Server } from 'node:http';
import { requestTestServer, serverOrigin } from './http-server.spec-helpers';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { parseHostedHttpsOrigin } from '@iptvnator/shared/interfaces';
import { listenHosted } from './hosted-listener';
import { HostedHttpsListener } from './hosted-https-listener';
import { closeGracefully } from './graceful-shutdown';
import { createWebBackendApp } from './web-backend-app';

const publicOrigin = 'https://library.example.test';
const host = 'library.example.test';
function get(
    server: Server,
    headers: Record<string, string>,
    method = 'OPTIONS'
) {
    return new Promise<{
        status: number;
        headers: import('node:http').IncomingHttpHeaders;
    }>((resolve, reject) => {
        const req = requestTestServer(
            server,
            serverOrigin(server),
            {
                path: '/provider-targets',
                method,
                headers,
            },
            (res) => {
                res.resume();
                res.once('end', () =>
                    resolve({ status: res.statusCode!, headers: res.headers })
                );
            }
        );
        req.once('error', reject);
        req.end();
    });
}

describe('dedicated HTTPS proxy listener', () => {
    const servers: Server[] = [];
    afterEach(async () => {
        await Promise.all(
            servers.splice(0).map((server) => closeGracefully(server, 0))
        );
    });

    it.each([
        'http://library.example.test',
        'https://user:secret@library.example.test',
        'https://library.example.test/path',
        'https://library.example.test/a/..',
        'https://library.example.test/?x=1',
        'https://library.example.test/#',
        'https://library.example.test\\',
    ])('rejects invalid origin %s', (value) => {
        expect(() => parseHostedHttpsOrigin(value)).toThrow();
    });

    it('normalizes default ports and accepts an explicit non-default HTTPS port', () => {
        expect(
            parseHostedHttpsOrigin('https://LIBRARY.example.test:443/').origin
        ).toBe(publicOrigin);
        expect(
            parseHostedHttpsOrigin('https://library.example.test:8443').host
        ).toBe(host + ':8443');
    });

    it('supports a local reverse proxy with exact public Host and Origin and compatible CORS', async () => {
        const app = createWebBackendApp({
            clientOrigins: ['*'],
            accessToken: 'synthetic-token',
        });
        const remote = await listenHosted(
            app,
            '127.0.0.1',
            0,
            new URL(publicOrigin)
        );
        servers.push(remote);
        const proxy = createServer((req, res) => {
            const upstream = requestTestServer(
                remote,
                serverOrigin(remote),
                {
                    path: req.url,
                    method: req.method,
                    headers: req.headers,
                },
                (response) => {
                    res.writeHead(response.statusCode!, response.headers);
                    response.pipe(res);
                }
            );
            upstream.on('error', () => res.writeHead(502).end());
            req.pipe(upstream);
        });
        await new Promise<void>((resolve) =>
            proxy.listen(0, '127.0.0.1', resolve)
        );
        servers.push(proxy);
        const good = await get(proxy, {
            host,
            origin: publicOrigin,
            'access-control-request-method': 'POST',
        });
        expect(good.status).toBe(200);
        expect(good.headers['access-control-allow-origin']).toBe(publicOrigin);
        expect(
            (await get(proxy, { host, origin: 'https://attacker.test' })).status
        ).toBe(403);
        expect(
            (
                await get(proxy, {
                    host: 'attacker.test',
                    origin: publicOrigin,
                    'x-forwarded-host': host,
                    'x-forwarded-proto': 'https',
                })
            ).status
        ).toBe(403);
        expect(
            (
                await get(proxy, {
                    host: `127.0.0.1:${(remote.address() as AddressInfo).port}`,
                })
            ).status
        ).toBe(403);
        // A browser navigation has no Origin header; API authentication remains required.
        expect((await get(remote, { host }, 'POST')).status).toBe(401);
        expect(
            (
                await get(
                    remote,
                    { host, authorization: 'Bearer wrong-code' },
                    'POST'
                )
            ).status
        ).toBe(401);
        expect(
            (
                await get(
                    remote,
                    { host, authorization: 'Bearer synthetic-token' },
                    'POST'
                )
            ).status
        ).toBe(400);
    });

    it('starts, stops, and restarts remote access on an ephemeral port', async () => {
        const remote = new HostedHttpsListener(express(), 0);
        try {
            expect(await remote.configure(publicOrigin)).toBe(publicOrigin);
            expect(await remote.configure(publicOrigin)).toBe(publicOrigin);
            expect(await remote.configure('')).toBe('');
            expect(await remote.configure(publicOrigin)).toBe(publicOrigin);
        } finally {
            await remote.stop();
        }
    });

    it('keeps the original listener serving after remote access stops', async () => {
        const app = express();
        app.use((_req, res) => res.sendStatus(204));
        const local = await listenHosted(app, '127.0.0.1', 0);
        servers.push(local);
        const remote = new HostedHttpsListener(app, 0);
        try {
            expect(await remote.configure(publicOrigin)).toBe(publicOrigin);
            expect(await remote.configure('')).toBe('');
            expect(
                (
                    await get(local, {
                        host: `127.0.0.1:${(local.address() as AddressInfo).port}`,
                    })
                ).status
            ).toBe(204);
        } finally {
            await remote.stop();
        }
    });
});
