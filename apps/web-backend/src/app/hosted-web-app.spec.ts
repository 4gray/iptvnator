import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchTestServer, requestTestServer, serverOrigin } from './http-server.spec-helpers';
import { closeGracefully } from './graceful-shutdown';
import { listenHosted } from './hosted-listener';
import { createHostedWebApp } from './hosted-web-app';
import { createHostedWorkerTransport } from './hosted-worker-transport';
import { createWebBackendApp } from './web-backend-app';

it('keeps Cloudflare authentication paths out of the hosted player', async () => {
    const assets = await mkdtemp(join(tmpdir(), '.iptvnator-hosted-web-'));
    try {
        await writeFile(join(assets, 'index.html'), '<title>Synthetic PWA</title>');
        const send = createHostedWorkerTransport(
            createHostedWebApp(createWebBackendApp({}), assets)
        );
        const headers = { Accept: 'text/html' };
        for (const path of [
            '/cdn-cgi/access/authorize',
            '/.well-known/oauth-authorization-server',
        ]) {
            const response = await send({ method: 'GET', path, headers });
            expect(response.status).toBe(404);
            expect(response.body).not.toContain('Synthetic PWA');
        }
        const player = await send({ method: 'GET', path: '/workspace/dashboard', headers });
        expect(player.status).toBe(200);
        expect(player.body).toContain('Synthetic PWA');
    } finally {
        await rm(assets, { recursive: true, force: true });
    }
});

it('serves browser routes and authenticated API at one origin and rejects foreign hosts', async () => {
    const worktree = await mkdtemp(join(tmpdir(), '.iptvnator-hosted-web-'));
    const assets = join(worktree, 'pwa');
    await mkdir(assets);
    const token = 'synthetic-access-code';
    await writeFile(join(assets, 'index.html'), '<title>Synthetic PWA</title>');
    const app = createHostedWebApp(
        createWebBackendApp({ accessToken: token }),
        assets
    );
    const server = await listenHosted(app, '127.0.0.1', 0);
    const origin = serverOrigin(server);
    const fetch = fetchTestServer(server);
    try {
        await rm(join(assets, 'index.html'));
        for (const path of ['/', '/index.html', '/workspace/dashboard']) {
            const response = await fetch(origin + path);
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/html');
            expect(await response.text()).toContain('Synthetic PWA');
        }
        const config = await fetch(origin + '/assets/app-config.js');
        expect(config.headers.get('cache-control')).toBe('no-store');
        expect(await config.text()).toContain('"/api"');
        expect((await fetch(origin + '/missing.js')).status).toBe(404);
        expect((await fetch(origin + '/api/health')).status).toBe(200);
        expect((await fetch(origin + '/api/unknown')).status).toBe(401);
        expect(
            (
                await fetch(origin + '/api/unknown', {
                    headers: { Authorization: `Bearer ${token}` },
                })
            ).status
        ).toBe(404);
        expect(
            (
                await fetch(origin + '/api/health', {
                    headers: { Origin: 'https://foreign.example.test' },
                })
            ).status
        ).toBe(403);
        const rebinding = await new Promise<number | undefined>(
            (resolve, reject) => {
                requestTestServer(
                    server,
                    origin + '/api/health',
                    {
                        headers: { Host: 'foreign.example.test' },
                    },
                    (response) => {
                        response.resume();
                        resolve(response.statusCode);
                    }
                )
                    .on('error', reject)
                    .end();
            }
        );
        expect(rebinding).toBe(403);
    } finally {
        await closeGracefully(server);
        await rm(worktree, { recursive: true, force: true });
    }
});
