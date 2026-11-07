import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { closeGracefully } from './graceful-shutdown';
import { listenHosted } from './hosted-listener';
import { createHostedWebApp } from './hosted-web-app';
import { createWebBackendApp } from './web-backend-app';

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
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
                request(
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
