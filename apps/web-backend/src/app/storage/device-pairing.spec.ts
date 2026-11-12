import { request } from 'node:http';
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
            expect(store.approve(claim.claimId)).toBe(false);
            expect(store.complete(claim.claimId, claim.claimSecret)).toBeNull();
        }));
});
