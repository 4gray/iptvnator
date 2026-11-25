import express from 'express';
import { type HostedWorkerRequest } from '@iptvnator/shared/interfaces';
import { hostedWorkerSockets, markHostedIngress } from '../hosted-ingress';
import { createHostedWorkerTransport } from '../hosted-worker-transport';
import { createDevicePairingRouter } from './device-pairing-router';
import { DevicePairingStore } from './device-pairing-store';
import { withTempStorage } from './server-storage.spec-helpers';

const origin = 'https://library.example.test';
const instanceId = 'synthetic-instance';
const adminCode = 'synthetic-admin-code';
const password = 'synthetic-browser-password';
const missingId = 'missing-device';

function fixture(store: DevicePairingStore, cloudflare = false) {
    const app = express();
    app.use((req, _res, next) => {
        if (req.get('x-test-browser') === 'yes') {
            hostedWorkerSockets.delete(req.socket);
            markHostedIngress(req, origin);
        }
        next();
    });
    app.use(
        '/v1',
        createDevicePairingRouter(
            store,
            adminCode,
            instanceId,
            { origin },
            true,
            cloudflare ? async () => false : undefined
        )
    );
    const send = createHostedWorkerTransport(app);
    const post = (
        path: string,
        body: unknown,
        headers?: HostedWorkerRequest['headers']
    ) =>
        send({
            path: `/v1/device-pairing/${path}`,
            method: 'POST',
            body,
            headers,
        });
    return { send, post };
}

describe('hosted device pairing routes', () => {
    it('validates worker commands and reports missing invitations, claims, and devices', () =>
        withTempStorage(async ({ database }) => {
            const store = new DevicePairingStore(database.sqlite);
            const { send, post } = fixture(store);
            const commands: [string, unknown, number][] = [
                ['browser-settings', { password: 1 }, 400],
                ['browser-settings', { password: 'short' }, 400],
                ['browser-settings', { password: null }, 204],
                ['start', { name: '   ' }, 400],
                ['start', { name: 't'.repeat(81) }, 400],
                ['invite', {}, 400],
                ['claim', { inviteId: 1, name: 'TV' }, 400],
                ['claim', { inviteId: missingId, name: 'TV' }, 404],
                ['complete', { claimId: missingId, claimSecret: 1 }, 400],
                [
                    'complete',
                    { claimId: missingId, claimSecret: 'synthetic-secret' },
                    404,
                ],
                ['approve', {}, 400],
                ['approve', { claimId: missingId }, 404],
            ];
            for (const [path, body, status] of commands) {
                expect(await post(path, body)).toMatchObject({ status });
            }
            expect(
                await send({
                    method: 'GET',
                    path: '/v1/device-pairing/browser-settings',
                })
            ).toMatchObject({
                status: 200,
                body: { passwordConfigured: false },
            });
            expect(
                await send({
                    method: 'PUT',
                    path: `/v1/devices/${missingId}/approval`,
                    body: { canApprove: 'yes' },
                })
            ).toMatchObject({ status: 400 });
            expect(
                await send({
                    method: 'PUT',
                    path: `/v1/devices/${missingId}/approval`,
                    body: { canApprove: true },
                })
            ).toMatchObject({ status: 404 });
            expect(
                await send({
                    method: 'DELETE',
                    path: `/v1/devices/${missingId}`,
                })
            ).toMatchObject({ status: 404 });
        }));

    it('binds tunnel invitations to the configured origin and reports capacity exhaustion', () =>
        withTempStorage(async ({ database }) => {
            const store = new DevicePairingStore(database.sqlite);
            const { post } = fixture(store, true);
            expect(
                await post('invite', { origin: 'https://other.example.test' })
            ).toMatchObject({ status: 400 });
            expect(await post('invite', { origin })).toMatchObject({
                status: 201,
            });
            for (let i = 0; i < 99; i += 1)
                expect(store.invite(origin)).not.toBeNull();
            expect(await post('invite', { origin })).toMatchObject({
                status: 429,
            });
            expect(await post('start', { name: 'Demo TV' })).toMatchObject({
                status: 429,
            });
        }));

    it('requires device approval permission and removes it when the desktop revokes access', () =>
        withTempStorage(async ({ database }) => {
            const store = new DevicePairingStore(database.sqlite);
            const { send, post } = fixture(store);
            const phone = store.start('Demo phone')!;
            const tv = store.start('Demo TV')!;
            expect(store.approve(phone.claimId)).toBe(true);
            const result = store.complete(phone.claimId, phone.claimSecret);
            if (result?.status !== 'approved')
                throw new Error('Test phone did not pair');
            const headers = { authorization: `Bearer ${result.token}` };
            const id = store.list().devices[0].id;
            const claim = { claimId: tv.claimId };
            expect(await post('device-request', claim)).toMatchObject({
                status: 403,
            });
            expect(await post('device-request', claim, headers)).toMatchObject({
                status: 403,
            });
            expect(
                await send({
                    method: 'PUT',
                    path: `/v1/devices/${id}/approval`,
                    body: { canApprove: true },
                })
            ).toMatchObject({ status: 204 });
            expect(await post('device-request', {}, headers)).toMatchObject({
                status: 404,
            });
            expect(
                await post('device-approve', { claimId: missingId }, headers)
            ).toMatchObject({ status: 404 });
            expect(await post('device-request', claim, headers)).toMatchObject({
                status: 200,
                body: {
                    name: 'Demo TV',
                    confirmationCode: tv.confirmationCode,
                },
            });
            expect(await post('device-approve', claim, headers)).toMatchObject({
                status: 204,
            });
            expect(store.complete(tv.claimId, tv.claimSecret)).toMatchObject({
                status: 'approved',
            });
            expect(
                await send({ method: 'DELETE', path: `/v1/devices/${id}` })
            ).toMatchObject({ status: 204 });
            expect(await post('device-request', claim, headers)).toMatchObject({
                status: 403,
            });
        }));

    it('distinguishes invalid or expired browser sessions from missing claims', () =>
        withTempStorage(async ({ database }) => {
            let now = Date.now();
            const store = new DevicePairingStore(database.sqlite, () => now);
            store.setPassword(password);
            const { post } = fixture(store);
            const headers = {
                'x-test-browser': 'yes',
                host: new URL(origin).host,
                origin,
            };
            const withCookie = (value: string) => ({
                ...headers,
                cookie: `other=value; iptvnator_pairing=${value}`,
            });
            expect(
                await post('browser-session', { password: 123 }, headers)
            ).toMatchObject({ status: 401 });
            expect(
                await post(
                    'browser-session',
                    { password },
                    { ...headers, host: 'other.example.test' }
                )
            ).toMatchObject({ status: 403 });
            expect(
                await post('browser-request', {}, withCookie('invalid'))
            ).toMatchObject({ status: 401 });
            expect(
                await post('browser-request', {}, withCookie('a'.repeat(129)))
            ).toMatchObject({ status: 401 });
            const valid = withCookie(store.createSession(password)!);
            expect(await post('browser-request', {}, valid)).toMatchObject({
                status: 404,
            });
            expect(
                await post('browser-approve', { claimId: missingId }, valid)
            ).toMatchObject({ status: 404 });
            now += 300_001;
            expect(await post('browser-request', {}, valid)).toMatchObject({
                status: 401,
            });
        }));
});
