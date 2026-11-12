import { createHash } from 'node:crypto';
import { createWebBackendApp } from '../web-backend-app';
import { withServer } from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import { DevicePairingStore } from './device-pairing-store';

describe('paired device TV approval', () => {
    it('upgrades the old table without changing devices and survives repeated startup', () =>
        withTempStorage((storage) => {
            const db = storage.database.sqlite;
            db.exec(
                'CREATE TABLE server_paired_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_digest TEXT NOT NULL UNIQUE)'
            );
            const digest = createHash('sha256')
                .update('old-token')
                .digest('hex');
            db.prepare(
                'INSERT INTO server_paired_devices VALUES (?, ?, ?)'
            ).run('old-id', 'Old device', digest);
            const first = new DevicePairingStore(db);
            expect(first.accepts('old-token')).toBe(true);
            expect(first.list().devices).toEqual([
                { id: 'old-id', name: 'Old device', canApprove: false },
            ]);
            expect(first.setApproval('old-id', true)).toBe(true);
            const restarted = new DevicePairingStore(db);
            expect(restarted.canApprove('old-token')).toBe(true);
            expect(restarted.list().devices).toEqual([
                { id: 'old-id', name: 'Old device', canApprove: true },
            ]);
        }));

    it('restricts approval to authorized device tokens and current TV claims', () =>
        withTempStorage(async (storage) => {
            const app = createWebBackendApp({
                storage,
                accessToken: 'admin-secret',
                devicePairingEnabled: true,
            });
            await withServer(app, async (base) => {
                const admin = { authorization: 'Bearer admin-secret' };
                const call = (
                    path: string,
                    body: unknown,
                    headers: Record<string, string> = {},
                    method = 'POST'
                ) =>
                    fetch(`${base}/v1${path}`, {
                        method,
                        headers: {
                            'content-type': 'application/json',
                            ...headers,
                        },
                        body: JSON.stringify(body),
                    });
                const initial = (await (
                    await call('/device-pairing/start', { name: 'Phone' })
                ).json()) as any;
                expect(
                    (
                        await call(
                            '/device-pairing/approve',
                            { claimId: initial.claimId },
                            admin
                        )
                    ).status
                ).toBe(204);
                const { token } = (await (
                    await call('/device-pairing/complete', initial)
                ).json()) as any;
                const phone = { authorization: `Bearer ${token}` };
                const list = (await (
                    await fetch(`${base}/v1/devices`, { headers: admin })
                ).json()) as any;
                const id = list.devices[0].id;
                expect(list.devices[0]).toEqual({
                    id,
                    name: 'Phone',
                    canApprove: false,
                });
                const tv = (await (
                    await call('/device-pairing/start', { name: 'TV' })
                ).json()) as any;
                const details = { claimId: tv.claimId };
                for (const headers of [
                    {},
                    admin,
                    phone,
                    { authorization: 'Bearer invalid' },
                    { cookie: 'iptvnator_pairing=invalid' },
                ]) {
                    expect(
                        (
                            await call(
                                '/device-pairing/device-request',
                                details,
                                headers
                            )
                        ).status
                    ).toBe(403);
                    expect(
                        (
                            await call(
                                '/device-pairing/device-approve',
                                details,
                                headers
                            )
                        ).status
                    ).toBe(403);
                }
                expect(
                    (
                        await call(
                            `/devices/${id}/approval`,
                            { canApprove: true },
                            phone,
                            'PUT'
                        )
                    ).status
                ).toBe(403);
                expect(
                    (
                        await call(
                            `/devices/${id}/approval`,
                            { canApprove: 'true' },
                            admin,
                            'PUT'
                        )
                    ).status
                ).toBe(400);
                expect(
                    (
                        await call(
                            '/devices/missing/approval',
                            { canApprove: true },
                            admin,
                            'PUT'
                        )
                    ).status
                ).toBe(404);
                expect(
                    (
                        await call(
                            `/devices/${id}/approval`,
                            { canApprove: true },
                            admin,
                            'PUT'
                        )
                    ).status
                ).toBe(204);
                expect(
                    await (
                        await call(
                            '/device-pairing/device-request',
                            details,
                            phone
                        )
                    ).json()
                ).toEqual({
                    name: 'TV',
                    confirmationCode: tv.confirmationCode,
                });
                const invite = (await (
                    await call('/device-pairing/invite', {}, admin)
                ).json()) as any;
                const invited = (await (
                    await call('/device-pairing/claim', {
                        ...invite,
                        name: 'Other phone',
                    })
                ).json()) as any;
                for (const claimId of ['invalid', invited.claimId]) {
                    expect(
                        (
                            await call(
                                '/device-pairing/device-request',
                                { claimId },
                                phone
                            )
                        ).status
                    ).toBe(404);
                    expect(
                        (
                            await call(
                                '/device-pairing/device-approve',
                                { claimId },
                                phone
                            )
                        ).status
                    ).toBe(404);
                }
                expect(
                    (
                        await call(
                            '/device-pairing/device-approve',
                            details,
                            phone
                        )
                    ).status
                ).toBe(204);
                expect(
                    (
                        await call(
                            '/device-pairing/device-request',
                            details,
                            phone
                        )
                    ).status
                ).toBe(404);
                expect(
                    (
                        await call(
                            '/device-pairing/device-approve',
                            details,
                            phone
                        )
                    ).status
                ).toBe(404);
                expect(
                    (
                        (await (
                            await call('/device-pairing/complete', tv)
                        ).json()) as any
                    ).status
                ).toBe('approved');
                expect(
                    (
                        await call(
                            `/devices/${id}/approval`,
                            { canApprove: false },
                            admin,
                            'PUT'
                        )
                    ).status
                ).toBe(204);
                expect(
                    (
                        await call(
                            '/device-pairing/device-request',
                            details,
                            phone
                        )
                    ).status
                ).toBe(403);
                expect(
                    (
                        await call(
                            `/devices/${id}/approval`,
                            { canApprove: true },
                            admin,
                            'PUT'
                        )
                    ).status
                ).toBe(204);
                expect(
                    (
                        await fetch(`${base}/v1/devices/${id}`, {
                            method: 'DELETE',
                            headers: admin,
                        })
                    ).status
                ).toBe(204);
                expect(
                    (
                        await call(
                            '/device-pairing/device-approve',
                            details,
                            phone
                        )
                    ).status
                ).toBe(403);
            });
        }));
});
