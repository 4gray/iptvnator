import { request } from 'node:http';
import express from 'express';
import { markHostedIngress, markHostedLan } from '../hosted-ingress';
import type { AddressInfo } from 'node:net';
import { listenHosted } from '../hosted-listener';
import { closeGracefully } from '../graceful-shutdown';
import { createWebBackendApp } from '../web-backend-app';
import { withServer } from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import { DevicePairingStore } from './device-pairing-store';

describe('device pairing', () => {
    it('requires local admin approval, persists revocable device access and consumes claims', () =>
        withTempStorage(async (storage) => {
            const app = createWebBackendApp({
                storage,
                accessToken: 'admin-secret',
                devicePairingEnabled: true,
            });
            await withServer(app, async (base) => {
                const admin = {
                    authorization: 'Bearer admin-secret',
                    'content-type': 'application/json',
                };
                const post = (
                    path: string,
                    body: unknown,
                    headers: Record<string, string> = {}
                ) =>
                    fetch(`${base}/v1${path}`, {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json',
                            ...headers,
                        },
                        body: JSON.stringify(body),
                    });
                expect((await post('/device-pairing/invite', {})).status).toBe(
                    403
                );
                const forgedHostStatus = await new Promise<number>(
                    (resolve, reject) => {
                        const req = request(
                            `${base}/v1/devices`,
                            {
                                headers: {
                                    authorization: 'Bearer admin-secret',
                                    host: 'remote.example.test',
                                },
                            },
                            (res) => {
                                res.resume();
                                resolve(res.statusCode!);
                            }
                        );
                        req.on('error', reject);
                        req.end();
                    }
                );
                expect(forgedHostStatus).toBe(403);
                const invite = (await (
                    await post('/device-pairing/invite', {}, admin)
                ).json()) as { inviteId: string };
                const claim = (await (
                    await post('/device-pairing/claim', {
                        ...invite,
                        name: 'Test device',
                    })
                ).json()) as {
                    claimId: string;
                    claimSecret: string;
                    confirmationCode: string;
                };
                expect(
                    (
                        await post('/device-pairing/claim', {
                            ...invite,
                            name: 'Test device',
                        })
                    ).status
                ).toBe(404);
                const credentials = {
                    claimId: claim.claimId,
                    claimSecret: claim.claimSecret,
                };
                expect(
                    await (
                        await post('/device-pairing/complete', credentials)
                    ).json()
                ).toEqual({ status: 'pending' });
                expect(
                    (
                        await post('/device-pairing/complete', {
                            ...credentials,
                            claimSecret: 'wrong',
                        })
                    ).status
                ).toBe(404);
                const list = (await (
                    await fetch(`${base}/v1/devices`, { headers: admin })
                ).json()) as { pending: unknown[] };
                expect(list.pending).toEqual([
                    {
                        claimId: claim.claimId,
                        inviteId: invite.inviteId,
                        name: 'Test device',
                        confirmationCode: claim.confirmationCode,
                    },
                ]);
                expect(
                    (
                        await post(
                            '/device-pairing/approve',
                            { claimId: claim.claimId },
                            admin
                        )
                    ).status
                ).toBe(204);
                const approved = (await (
                    await post('/device-pairing/complete', credentials)
                ).json()) as { token: string; instanceId: string };
                expect(approved.instanceId).toBe(storage.database.instanceId);
                expect(
                    (await post('/device-pairing/complete', credentials)).status
                ).toBe(404);
                const deviceHeaders = {
                    authorization: `Bearer ${approved.token}`,
                };
                const playlists = await fetch(`${base}/v1/playlists`, {
                    headers: deviceHeaders,
                });
                expect(playlists.status).toBe(200);
                expect(playlists.headers.get('ratelimit')).toBeNull();
                expect(
                    (
                        await fetch(`${base}/v1/devices`, {
                            headers: deviceHeaders,
                        })
                    ).status
                ).toBe(403);
                expect(
                    new DevicePairingStore(storage.database.sqlite).accepts(
                        approved.token
                    )
                ).toBe(true);
                const devices = (await (
                    await fetch(`${base}/v1/devices`, { headers: admin })
                ).json()) as { devices: { id: string; name: string }[] };
                expect(devices.devices).toHaveLength(1);
                expect(
                    (
                        await fetch(
                            `${base}/v1/devices/${devices.devices[0].id}`,
                            { method: 'DELETE', headers: admin }
                        )
                    ).status
                ).toBe(204);
                expect(
                    (
                        await fetch(`${base}/v1/playlists`, {
                            headers: deviceHeaders,
                        })
                    ).status
                ).toBe(401);
            });
        }));

    it('uses the trusted LAN listener when ingress starts with an empty origin', () =>
        withTempStorage(async (storage) => {
            const ingress = { origin: '' };
            const api = createWebBackendApp({
                storage,
                accessToken: 'admin-secret',
                devicePairingEnabled: true,
                hostedIngress: ingress,
            });
            const app = express();
            app.use((req, _res, next) => {
                if (req.get('x-test-lan') === 'yes')
                    markHostedLan(req, 'http://192.168.1.2:4334');
                next();
            });
            app.use(api);
            await withServer(app, async (base) => {
                const start = async (headers: Record<string, string> = {}) =>
                    (
                        await fetch(`${base}/v1/device-pairing/start`, {
                            method: 'POST',
                            headers: {
                                'content-type': 'application/json',
                                ...headers,
                            },
                            body: JSON.stringify({ name: 'TV' }),
                        })
                    ).json() as Promise<{
                        claimId: string;
                        approvalUrl: string | null;
                    }>;
                expect((await start()).approvalUrl).toBeNull();
                const lan = await start({ 'x-test-lan': 'yes' });
                expect(lan.approvalUrl).toBe(
                    `http://192.168.1.2:4334/approve-device/${lan.claimId}`
                );
                ingress.origin = 'https://library.example.test';
                const remote = await start({ 'x-test-lan': 'yes' });
                expect(remote.approvalUrl).toBe(
                    `https://library.example.test/approve-device/${remote.claimId}`
                );
            });
        }));
    it('expires invitations and claims', () =>
        withTempStorage((storage) => {
            let now = 0;
            const store = new DevicePairingStore(
                storage.database.sqlite,
                () => now
            );
            const invite = store.invite()!;
            now += 300_001;
            expect(store.claim(invite.inviteId, 'Test device')).toBeNull();
            const another = store.invite()!;
            const claim = store.claim(another.inviteId, 'Test device')!;
            now += 300_001;
            expect(store.browserRequest(claim.claimId)).toBeNull();
            expect(store.browserApprove(claim.claimId)).toBe(false);
            expect(store.approve(claim.claimId)).toBe(false);
            expect(store.complete(claim.claimId, claim.claimSecret)).toBeNull();
        }));
    it('allows only the configured ingress to approve TV claims and invalidates sessions on password rotation', () =>
        withTempStorage(async (storage) => {
            const origin = 'https://library.example.test';
            const state = { origin };
            const app = createWebBackendApp({
                storage,
                accessToken: 'admin-secret',
                devicePairingEnabled: true,
                hostedIngress: state,
            });
            const local = await listenHosted(app, '127.0.0.1', 0);
            const remote = await listenHosted(
                app,
                '127.0.0.1',
                0,
                new URL(origin)
            );
            const call = (
                server: typeof local,
                path: string,
                body: unknown,
                headers: Record<string, string> = {}
            ) =>
                new Promise<{ status: number; body: any; cookie: string }>(
                    (resolve, reject) => {
                        const data = JSON.stringify(body);
                        const req = request(
                            {
                                host: '127.0.0.1',
                                port: (server.address() as AddressInfo).port,
                                path: `/v1/device-pairing/${path}`,
                                method: 'POST',
                                headers: {
                                    'content-type': 'application/json',
                                    'content-length': Buffer.byteLength(data),
                                    ...headers,
                                },
                            },
                            (res) => {
                                let text = '';
                                res.on('data', (chunk) => (text += chunk));
                                res.on('end', () =>
                                    resolve({
                                        status: res.statusCode!,
                                        body: text.startsWith('{')
                                            ? JSON.parse(text)
                                            : null,
                                        cookie:
                                            res.headers['set-cookie']?.[0] ??
                                            '',
                                    })
                                );
                            }
                        );
                        req.on('error', reject);
                        req.end(data);
                    }
                );
            const admin = { authorization: 'Bearer admin-secret' };
            const browser = { host: 'library.example.test', origin };
            try {
                const before = await call(local, 'start', {
                    name: 'Living room TV',
                });
                expect(before.body.approvalUrl).toBe(
                    `${origin}/approve-device/${before.body.claimId}`
                );
                expect(
                    (
                        await call(
                            remote,
                            'browser-request',
                            { claimId: before.body.claimId },
                            browser
                        )
                    ).status
                ).toBe(409);
                expect(
                    (
                        await call(
                            remote,
                            'browser-request',
                            { claimId: before.body.claimId },
                            { ...browser, origin: 'https://attacker.test' }
                        )
                    ).status
                ).toBe(403);
                expect(
                    (
                        await call(
                            local,
                            'browser-settings',
                            { password: 'synthetic-password' },
                            admin
                        )
                    ).status
                ).toBe(204);
                const row = storage.database.sqlite
                    .prepare(
                        'SELECT password_hash FROM server_pairing_settings'
                    )
                    .get() as { password_hash: string };
                expect(row.password_hash).not.toContain('synthetic-password');
                expect(
                    new DevicePairingStore(
                        storage.database.sqlite
                    ).passwordConfigured()
                ).toBe(true);
                const claim = (
                    await call(local, 'start', { name: 'Living room TV' })
                ).body;
                expect(claim.approvalUrl).toBe(
                    `${origin}/approve-device/${claim.claimId}`
                );
                expect(
                    (
                        await call(
                            local,
                            'browser-session',
                            { password: 'synthetic-password' },
                            { ...browser, 'x-forwarded-proto': 'https' }
                        )
                    ).status
                ).toBe(403);
                expect(
                    (
                        await call(
                            remote,
                            'browser-session',
                            { password: 'incorrect-password' },
                            browser
                        )
                    ).status
                ).toBe(401);
                const session = await call(
                    remote,
                    'browser-session',
                    { password: 'synthetic-password' },
                    browser
                );
                expect(session.status).toBe(204);
                expect(session.cookie).toContain('HttpOnly');
                expect(session.cookie).toContain('Secure');
                expect(session.cookie).toContain('SameSite=Strict');
                const authenticated = {
                    ...browser,
                    cookie: session.cookie.split(';')[0],
                };
                expect(
                    (
                        await call(
                            remote,
                            'browser-request',
                            { claimId: claim.claimId },
                            authenticated
                        )
                    ).body
                ).toEqual({
                    name: 'Living room TV',
                    confirmationCode: claim.confirmationCode,
                });
                const invite = (await call(local, 'invite', {}, admin)).body;
                const invited = (
                    await call(local, 'claim', { ...invite, name: 'Phone' })
                ).body;
                expect(
                    (
                        await call(
                            remote,
                            'browser-approve',
                            { claimId: invited.claimId },
                            authenticated
                        )
                    ).status
                ).toBe(404);
                expect(
                    (
                        await call(
                            remote,
                            'browser-approve',
                            { claimId: claim.claimId },
                            authenticated
                        )
                    ).status
                ).toBe(204);
                expect(
                    (
                        await call(local, 'complete', {
                            claimId: claim.claimId,
                            claimSecret: claim.claimSecret,
                        })
                    ).body.status
                ).toBe('approved');
                expect(
                    (
                        await call(
                            local,
                            'browser-settings',
                            { password: 'new-synthetic-password' },
                            admin
                        )
                    ).status
                ).toBe(204);
                expect(
                    (
                        await call(
                            remote,
                            'browser-request',
                            { claimId: before.body.claimId },
                            authenticated
                        )
                    ).status
                ).toBe(401);
                expect(
                    (
                        await call(
                            remote,
                            'browser-request',
                            { claimId: before.body.claimId },
                            {
                                ...authenticated,
                                origin: 'https://attacker.test',
                            }
                        )
                    ).status
                ).toBe(403);
                expect(
                    (
                        await call(
                            local,
                            'browser-settings',
                            { password: null },
                            admin
                        )
                    ).status
                ).toBe(204);
                expect(
                    (
                        await call(
                            remote,
                            'browser-session',
                            { password: 'new-synthetic-password' },
                            browser
                        )
                    ).status
                ).toBe(401);
            } finally {
                await closeGracefully(local, 0);
                await closeGracefully(remote, 0);
            }
        }));
    it('denies local administrator access to marked ingress even with a loopback host and shared token', () =>
        withTempStorage(async (storage) => {
            const api = createWebBackendApp({
                storage,
                accessToken: 'admin-secret',
                devicePairingEnabled: true,
            });
            const app = express();
            app.use((req, _res, next) => {
                markHostedIngress(req, `https://${req.headers.host}`);
                next();
            });
            app.use(api);
            await withServer(app, async (base) => {
                const headers = {
                    authorization: 'Bearer admin-secret',
                    'content-type': 'application/json',
                };
                expect(
                    (
                        await fetch(
                            `${base}/v1/device-pairing/browser-settings`,
                            { headers }
                        )
                    ).status
                ).toBe(403);
                expect(
                    (
                        await fetch(
                            `${base}/v1/device-pairing/browser-settings`,
                            {
                                method: 'POST',
                                headers,
                                body: JSON.stringify({
                                    password: 'synthetic-password',
                                }),
                            }
                        )
                    ).status
                ).toBe(403);
                expect(
                    new DevicePairingStore(
                        storage.database.sqlite
                    ).passwordConfigured()
                ).toBe(false);
            });
        }));
});
