import express from 'express';
import { hostedIngressOrigin, hostedWorkerSockets, markHostedIngress } from '../hosted-ingress';
import { createHostedWorkerTransport } from '../hosted-worker-transport';
import { createWebBackendApp } from '../web-backend-app';
import { DevicePairingStore } from './device-pairing-store';
import { withTempStorage } from './server-storage.spec-helpers';

const origin = 'https://library.example.test';
const first = 'a'.repeat(43);
const second = 'b'.repeat(43);
const third = 'c'.repeat(43);

it('requires Access and a fresh one-time host invitation to restore a revoked device', () =>
    withTempStorage(async (storage) => {
        const app = express();
        let deviceStatus: unknown;
        app.use((req, res, next) => {
            if (req.get('x-test-remote')) {
                hostedWorkerSockets.delete(req.socket);
                markHostedIngress(req, origin);
                res.once('finish', () => {
                    deviceStatus = res.getHeader('x-iptvnator-device-status');
                });
            }
            next();
        });
        app.use(createWebBackendApp({
            storage,
            accessToken: 'synthetic-owner',
            devicePairingEnabled: true,
            hostedIngress: { origin },
            hostedMode: 'cloudflare',
            cloudflareAccess: async (req) => hostedIngressOrigin(req) === origin &&
                req.headers.authorization === 'Bearer synthetic-access',
        }));
        const send = createHostedWorkerTransport(app);
        const invite = async () => {
            const response = await send({ method: 'POST', path: '/v1/device-pairing/invite', body: { origin } });
            expect(response.status).toBe(201);
            return (response.body as { inviteId: string }).inviteId;
        };
        const remote = {
            authorization: 'Bearer synthetic-access',
            'x-test-remote': 'yes',
            'x-iptvnator-instance-id': storage.database.instanceId,
        };
        const enroll = (key: string, inviteId: string, headers = remote) => send({
            method: 'POST', path: '/v1/device-pairing/cloudflare',
            headers: { ...headers, 'x-iptvnator-device-key': key },
            body: { inviteId, name: 'Synthetic phone' },
        });
        const sources = (key?: string, headers = remote) => send({
            method: 'GET', path: '/v1/sources',
            headers: { ...headers, ...(key ? { 'x-iptvnator-device-key': key } : {}) },
        });
        const firstInvite = await invite();
        const firstStatusPath = '/v1/devices?invite=' + firstInvite;
        expect((await send({ method: 'GET', path: firstStatusPath })).body).toMatchObject({ inviteActive: true });
        expect((await send({ method: 'GET', path: firstStatusPath, headers: remote })).status).toBe(403);
        expect((await enroll(first, firstInvite, { ...remote, authorization: '' })).status).toBe(403);
        expect((await sources()).status).toBe(403);
        expect((await enroll(first, '')).status).toBe(403);
        expect((await enroll(first, firstInvite)).status).toBe(204);
        expect((await send({ method: 'GET', path: firstStatusPath })).body).toMatchObject({ inviteActive: false });
        expect((await enroll(second, firstInvite)).status).toBe(403);
        expect((await enroll(first, '')).status).toBe(204);
        expect((await enroll(second, await invite())).status).toBe(204);
        expect((await sources(first)).status).toBe(200);
        expect((await sources(first, { ...remote, authorization: '' })).status).toBe(403);
        expect((await send({ method: 'GET', path: '/v1/devices', headers: remote })).status).toBe(403);

        const device = new DevicePairingStore(storage.database.sqlite).list(true).devices[0];
        const approve = (value: boolean) => send({
            method: 'PUT',
            path: '/v1/devices/' + device.id + '/approval',
            body: { canApprove: value },
        });
        const inviteFromDevice = (key: string, headers = remote) => send({
            method: 'POST', path: '/v1/device-pairing/cloudflare-invite',
            headers: { ...headers, 'x-iptvnator-device-key': key },
        });
        expect((await inviteFromDevice(first)).status).toBe(403);
        expect((await approve(true)).status).toBe(204);
        expect((await inviteFromDevice(first, { ...remote, authorization: '' })).status).toBe(403);
        expect((await inviteFromDevice(second)).status).toBe(403);
        const delegated = await inviteFromDevice(first);
        expect(delegated.status).toBe(201);
        const delegatedId = (delegated.body as { inviteId: string }).inviteId;
        expect((await enroll(third, delegatedId)).status).toBe(204);
        const delegatedHead = await send({
            method: 'HEAD', path: '/v1/sources',
            headers: { ...remote, 'x-iptvnator-device-key': third },
        });
        expect(delegatedHead.status).toBe(200);
        const unused = await inviteFromDevice(first);
        expect(unused.status).toBe(201);
        expect((await approve(false)).status).toBe(204);
        expect((await approve(true)).status).toBe(204);
        const unusedId = (unused.body as { inviteId: string }).inviteId;
        expect((await enroll('d'.repeat(43), unusedId)).status).toBe(403);
        expect((await send({ method: 'DELETE', path: '/v1/devices/' + device.id })).status).toBe(204);
        expect((await inviteFromDevice(first)).status).toBe(403);
        expect(await sources(first)).toMatchObject({
            status: 403,
            body: { code: 'revoked' },
        });
        expect(deviceStatus).toBe('revoked');
        expect((await enroll(first, '')).body).toEqual({ code: 'revoked' });
        expect((await enroll(first, firstInvite)).body).toEqual({ code: 'revoked' });
        expect((await sources(second)).status).toBe(200);
        expect(new DevicePairingStore(storage.database.sqlite).cloudflareDevice(first)).toBe('revoked');
        expect(new DevicePairingStore(storage.database.sqlite).accepts(second)).toBe(false);

        const replacement = await invite();
        const replacementStatus = '/v1/devices?invite=' + replacement;
        expect((await enroll(first, replacement, { ...remote, authorization: '' })).status).toBe(403);
        expect((await send({ method: 'GET', path: replacementStatus })).body).toMatchObject({ inviteActive: true });
        expect((await enroll(first, replacement)).status).toBe(204);
        expect((await send({ method: 'GET', path: replacementStatus })).body).toMatchObject({ inviteActive: false });
        expect((await enroll('d'.repeat(43), replacement)).status).toBe(403);
        expect((await sources(first)).status).toBe(200);
        expect(new DevicePairingStore(storage.database.sqlite).list(true).devices).toContainEqual(device);

        const browser = { ...remote, origin, cookie: '__Host-iptvnator-device=' + 'e'.repeat(43) };
        const browserInvite = await invite();
        expect((await send({
            method: 'POST', path: '/v1/device-pairing/cloudflare',
            headers: { ...browser, origin: 'https://foreign.example.test' },
            body: { inviteId: browserInvite, name: 'Synthetic browser' },
        })).status).toBe(403);
        expect((await send({
            method: 'POST', path: '/v1/device-pairing/cloudflare', headers: browser,
            body: { inviteId: browserInvite, name: 'Synthetic browser' },
        })).status).toBe(204);
        expect((await sources(undefined, browser)).status).toBe(200);
    }));
