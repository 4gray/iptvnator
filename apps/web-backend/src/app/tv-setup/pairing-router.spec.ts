import { createWebBackendApp } from '../web-backend-app';
import { withServer } from '../web-backend-app.spec-helpers';
import type { PairingStore } from './pairing-store';
type CreatedSession = ReturnType<PairingStore['create']>;
it('keeps server-token routes protected while delegating only a one-session phone capability', async () => {
    await withServer(
        createWebBackendApp({
            accessToken: 'server-secret',
            clientOrigins: ['http://tv.local'],
        }),
        async (base) => {
            const identity = await fetch(`${base}/tv/connection`, {
                headers: { Origin: 'http://unknown.local' },
            });
            expect(identity.headers.get('access-control-allow-origin')).toBe(
                '*'
            );
            expect(await identity.json()).toMatchObject({
                service: 'iptvnator',
                auth: 'token',
                protocol: 1,
            });
            expect(
                (await fetch(`${base}/tv/pairing`, { method: 'POST' })).status
            ).toBe(401);
            expect((await fetch(`${base}/tv/connection/check`)).status).toBe(
                401
            );
            const created = await fetch(`${base}/tv/pairing`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer server-secret',
                    Origin: 'http://tv.local',
                },
            });
            expect(created.status).toBe(201);
            const session = (await created.json()) as CreatedSession;
            const phone = `${base}/tv/pairing/${session.id}/phone`;
            expect((await fetch(phone)).status).toBe(403);
            const posted = await fetch(phone, {
                method: 'POST',
                headers: {
                    'X-TV-Pairing': session.phoneToken,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    provider: 'm3u',
                    name: 'Mobile',
                    url: 'https://provider.example/list.m3u',
                }),
            });
            expect(posted.status).toBe(200);
            const receipt = await fetch(phone, {
                headers: { 'X-TV-Pairing': session.phoneToken },
            });
            expect(await receipt.json()).toMatchObject({ status: 'pending' });
            expect(
                (
                    await fetch(`${base}/provider-targets`, {
                        method: 'POST',
                        headers: { 'X-TV-Pairing': session.phoneToken },
                    })
                ).status
            ).toBe(401);
            const page = await fetch(`${base}/tv/setup`);
            expect(page.headers.get('referrer-policy')).toBe('no-referrer');
            expect(page.headers.get('content-security-policy')).toContain(
                "frame-ancestors 'none'"
            );
            expect(await page.text()).not.toContain(session.phoneToken);
            expect((await fetch(`${base}/tv/setup.js`)).status).toBe(200);
            expect(
                (
                    await fetch(`${base}/tv/pairing/${session.id}/tv`, {
                        method: 'POST',
                        headers: {
                            'X-TV-Pairing': session.tvToken,
                            'Content-Type': 'application/json',
                        },
                        body: '{"outcome":"saved"}',
                    })
                ).status
            ).toBe(200);
        }
    );
});
it('bounds JSON bodies and never exposes malformed request contents', async () => {
    await withServer(createWebBackendApp(), async (base) => {
        const created = await fetch(`${base}/tv/pairing`, { method: 'POST' });
        const s = (await created.json()) as CreatedSession;
        const response = await fetch(`${base}/tv/pairing/${s.id}/phone`, {
            method: 'POST',
            headers: {
                'X-TV-Pairing': s.phoneToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ password: 'do-not-log'.repeat(3000) }),
        });
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain('do-not-log');
    });
});

it('shares a bounded setup asset budget and ignores spoofed forwarding headers', async () => {
    await withServer(createWebBackendApp(), async (base) => {
        const assets = ['/setup', '/setup.css', '/setup.js'];
        for (let index = 0; index < 60; index++) {
            const response = await fetch(`${base}/tv${assets[index % 3]}`);
            expect(response.status).toBe(200);
            await response.arrayBuffer();
        }
        for (const asset of assets) {
            const response = await fetch(`${base}/tv${asset}`, {
                headers: { 'X-Forwarded-For': '192.0.2.123' },
            });
            expect(response.status).toBe(429);
            expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(
                0
            );
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(await response.json()).toEqual({
                message: 'Too many setup requests. Try again shortly.',
            });
        }
        // Discovery and active pairing polling do not consume the asset budget.
        expect((await fetch(`${base}/tv/connection`)).status).toBe(200);
        const session = await fetch(`${base}/tv/pairing`, { method: 'POST' });
        expect(session.status).toBe(201);
        const created = (await session.json()) as CreatedSession;
        const poll = await fetch(`${base}/tv/pairing/${created.id}/tv`, {
            headers: { 'X-TV-Pairing': created.tvToken },
        });
        expect(poll.status).toBe(200);
    });
});
