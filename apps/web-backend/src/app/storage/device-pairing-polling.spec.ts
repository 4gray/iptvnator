import express from 'express';
import { withServer } from '../web-backend-app.spec-helpers';
import { createDevicePairingRouter } from './device-pairing-router';
import { DevicePairingStore } from './device-pairing-store';
import { withTempStorage } from './server-storage.spec-helpers';

it('lets devices sharing one peer poll and finish under independent claim budgets', () =>
    withTempStorage(async ({ database }) => {
        const store = new DevicePairingStore(database.sqlite);
        const app = express();
        app.use(
            '/v1',
            createDevicePairingRouter(store, 'test-admin', 'test-instance')
        );
        await withServer(app, async (origin, send) => {
            const post = (action: string, body: object) =>
                send(origin + '/v1/device-pairing/' + action, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            const devices = await Promise.all(
                ['Test TV', 'Test phone'].map(async (name) => {
                    const admission = await post('start', { name });
                    expect(admission.status).toBe(201);
                    const { claimId, claimSecret } = await admission.json();
                    return {
                        claimId,
                        poll: () => post('complete', { claimId, claimSecret }),
                        peerPolicy: admission.headers.get('ratelimit-policy'),
                    };
                })
            );
            const [first, second] = devices;
            expect(first.peerPolicy).toBeTruthy();
            expect(second.peerPolicy).toBe(first.peerPolicy);
            const pending = await Promise.all(
                devices.map((device) => device.poll())
            );
            for (const response of pending) {
                expect(await response.json()).toEqual({ status: 'pending' });
                expect(response.headers.get('ratelimit')).toContain('r=119;');
                expect(response.headers.get('ratelimit-policy')).not.toBe(
                    first.peerPolicy
                );
            }
            expect(pending[0].headers.get('ratelimit-policy')).not.toBe(
                pending[1].headers.get('ratelimit-policy')
            );
            for (const device of devices) {
                expect(store.approve(device.claimId)).toBe(true);
                const completion = await device.poll();
                expect(await completion.json()).toMatchObject({
                    status: 'approved',
                    instanceId: 'test-instance',
                });
                expect(completion.headers.get('ratelimit')).toContain('r=118;');
            }
            const replay = await first.poll();
            expect(replay.status).toBe(404);
            expect(replay.headers.get('ratelimit-policy')).toBe(
                first.peerPolicy
            );
        });
    }));
