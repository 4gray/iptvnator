import { randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { CloudflareAccessCheck } from '../cloudflare-access';
import { hostedIngressOrigin } from '../hosted-ingress';
import type { DevicePairingStore } from './device-pairing-store';

const COOKIE = '__Host-iptvnator-device';
const KEY = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_HEADER = 'x-iptvnator-device-key';
const STATUS_HEADER = 'x-iptvnator-device-status';

export function browserCloudflareDeviceKey(req: Request): string {
    const key = req.get('cookie')?.split(';').map((value) => value.trim())
        .find((value) => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) ?? '';
    return KEY.test(key) ? key : '';
}

export function prepareCloudflareBrowserDevice(req: Request, res: Response): void {
    if (browserCloudflareDeviceKey(req)) return;
    res.cookie(COOKIE, randomBytes(32).toString('base64url'), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60 * 1000,
    });
}

function deviceKey(req: Request): string {
    const header = req.get(DEVICE_HEADER);
    return header === undefined ? browserCloudflareDeviceKey(req) : KEY.test(header) ? header : '';
}

export function cloudflareDeviceState(req: Request, store: DevicePairingStore) {
    const key = deviceKey(req);
    return key ? store.cloudflareDevice(key) : 'unknown';
}

export function cloudflareDeviceError(res: Response, state: 'revoked' | 'unknown') {
    const code = state === 'revoked' ? 'revoked' : 'registration_required';
    res.set(STATUS_HEADER, code).set('Cache-Control', 'no-store').status(403).json({ code });
}

export function inviteFromCloudflareDevice(
    store: DevicePairingStore,
    instanceId: string,
    check: CloudflareAccessCheck
): RequestHandler {
    return async (req, res) => {
        const origin = hostedIngressOrigin(req);
        const key = req.get(DEVICE_HEADER);
        if (!origin || !key || !KEY.test(key) || !(await check(req))) {
            res.sendStatus(403);
            return;
        }
        if (req.get('x-iptvnator-instance-id') !== instanceId) {
            res.sendStatus(409);
            return;
        }
        const approver = store.cloudflareApprover(key);
        if (!approver) {
            const state = store.cloudflareDevice(key);
            if (state !== 'active') cloudflareDeviceError(res, state);
            else res.sendStatus(403);
            return;
        }
        const invite = store.invite(origin, true, approver);
        if (!invite) {
            res.sendStatus(429);
            return;
        }
        res.status(201).json(invite);
    };
}

export function registerCloudflareDevice(
    store: DevicePairingStore,
    instanceId: string,
    check: CloudflareAccessCheck
): RequestHandler {
    return async (req, res) => {
        const origin = hostedIngressOrigin(req);
        if (!origin || !(await check(req)) ||
            (!req.get(DEVICE_HEADER) && req.get('origin') !== origin)) {
            res.sendStatus(403);
            return;
        }
        const { inviteId = '', name } = req.body ?? {};
        const key = deviceKey(req);
        if (!key || typeof inviteId !== 'string' || (inviteId && !KEY.test(inviteId))
            || typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
            res.sendStatus(400);
            return;
        }
        if (req.get('x-iptvnator-instance-id') !== instanceId) {
            res.sendStatus(409);
            return;
        }
        const state = store.registerCloudflareDevice(inviteId, origin, name.trim(), key);
        if (state !== 'active') {
            cloudflareDeviceError(res, state);
            return;
        }
        res.sendStatus(204);
    };
}
