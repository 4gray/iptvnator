import {
    HOSTED_PAIRING_PASSWORD_MIN_LENGTH,
    HOSTED_PAIRING_PASSWORD_MAX_LENGTH,
} from '@iptvnator/shared/interfaces';
import express, { type RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { DevicePairingStore } from './device-pairing-store';
import { matchesAccessToken, readBearerToken } from './access-guard';
import type { CloudflareAccessCheck } from '../cloudflare-access';
import { inviteFromCloudflareDevice, registerCloudflareDevice } from './cloudflare-device-access';
import {
    hostedIngressOrigin,
    hostedLanOrigin,
    isHostedWorkerRequest,
    type HostedIngressState,
} from '../hosted-ingress';

/** Mounted before the main guard; admin requires both the shared token and local listener. */
export function createDevicePairingRouter(
    store: DevicePairingStore,
    sharedToken: string,
    instanceId: string,
    ingress?: HostedIngressState,
    workerOnly = false,
    cloudflareAccess?: CloudflareAccessCheck
) {
    const router = express.Router();
    const pairingPaths = ['/device-pairing', '/devices'];
    router.use(pairingPaths, (_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    router.use(
        pairingPaths,
        rateLimit({
            windowMs: 60_000,
            limit: 120,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            keyGenerator: (req) =>
                ipKeyGenerator(req.socket.remoteAddress ?? 'unknown'),
        })
    );
    router.use(pairingPaths, express.json({ limit: '4kb' }));
    const admin: RequestHandler = (req, res, next) => {
        if (isHostedWorkerRequest(req)) {
            next();
            return;
        }
        const local =
            !workerOnly && !hostedIngressOrigin(req) &&
            req.socket.remoteAddress === '127.0.0.1' &&
            req.socket.localAddress === '127.0.0.1' &&
            req.get('host') === `127.0.0.1:${req.socket.localPort}`;
        if (
            !local ||
            !matchesAccessToken(req.get('authorization'), sharedToken)
        ) {
            res.sendStatus(403);
            return;
        }
        next();
    };
    router.get('/device-pairing/browser-settings', admin, (_req, res) => {
        res.json({ passwordConfigured: store.passwordConfigured() });
    });
    router.post('/device-pairing/browser-settings', admin, (req, res) => {
        const password = req.body?.password;
        if (
            password !== null &&
            (typeof password !== 'string' ||
                password.length < HOSTED_PAIRING_PASSWORD_MIN_LENGTH ||
                password.length > HOSTED_PAIRING_PASSWORD_MAX_LENGTH)
        ) {
            res.sendStatus(400);
            return;
        }
        store.setPassword(password);
        res.sendStatus(204);
    });
    router.post('/device-pairing/start', (req, res) => {
        const name = req.body?.name;
        if (
            typeof name !== 'string' ||
            !name.trim() ||
            name.trim().length > 80
        ) {
            res.sendStatus(400);
            return;
        }
        const claim = store.start(name.trim());
        if (!claim) {
            res.sendStatus(429);
            return;
        }
        const origin = ingress?.origin || hostedLanOrigin(req);
        const approvalUrl = origin
            ? `${origin}/approve-device/${claim.claimId}`
            : null;
        res.status(201).json({ ...claim, approvalUrl });
    });
    const browserIngress: RequestHandler = (req, res, next) => {
        const origin = hostedIngressOrigin(req);
        if (
            !origin ||
            origin !== ingress?.origin ||
            req.get('host') !== new URL(origin).host ||
            req.get('origin') !== origin
        ) {
            res.sendStatus(403);
            return;
        }
        next();
    };
    const authLimit = rateLimit({
        windowMs: 60_000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        keyGenerator: (req) =>
            ipKeyGenerator(req.socket.remoteAddress ?? 'unknown'),
    });
    router.post(
        '/device-pairing/browser-session',
        browserIngress,
        authLimit,
        (req, res) => {
            const password = req.body?.password;
            if (
                typeof password !== 'string' ||
                password.length < HOSTED_PAIRING_PASSWORD_MIN_LENGTH ||
                password.length > HOSTED_PAIRING_PASSWORD_MAX_LENGTH
            ) {
                res.sendStatus(401);
                return;
            }
            const token = store.createSession(password);
            if (!token) {
                res.sendStatus(401);
                return;
            }
            // The cookie carries an encrypted, short-lived session ID.
            res.cookie('iptvnator_pairing', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'strict',
                path: '/api/v1/device-pairing',
                maxAge: 300_000,
            });
            res.sendStatus(204);
        }
    );
    const browserSession: RequestHandler = (req, res, next) => {
        const cookie = req
            .get('cookie')
            ?.split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith('iptvnator_pairing='));
        const token = cookie?.slice('iptvnator_pairing='.length) ?? '';
        if (!token || token.length > 128 || !store.acceptsSession(token)) {
            res.sendStatus(401);
            return;
        }
        next();
    };
    router.post(
        '/device-pairing/browser-request',
        browserIngress,
        (req, res, next) => {
            if (!store.passwordConfigured()) {
                res.sendStatus(409);
                return;
            }
            next();
        },
        browserSession,
        (req, res) => {
            const id = req.body?.claimId;
            const claim =
                typeof id === 'string' && id.length <= 128
                    ? store.browserRequest(id)
                    : null;
            if (!claim) {
                res.sendStatus(404);
                return;
            }
            res.json(claim);
        }
    );
    router.post(
        '/device-pairing/browser-approve',
        browserIngress,
        browserSession,
        (req, res) => {
            const id = req.body?.claimId;
            if (
                typeof id !== 'string' ||
                id.length > 128 ||
                !store.browserApprove(id)
            ) {
                res.sendStatus(404);
                return;
            }
            res.sendStatus(204);
        }
    );
    const deviceApprover: RequestHandler = (req, res, next) => {
        const token = readBearerToken(req.get('authorization'));
        if (!token || !store.canApprove(token)) {
            res.sendStatus(403);
            return;
        }
        next();
    };
    router.post(
        '/device-pairing/device-request',
        deviceApprover,
        (req, res) => {
            const id = req.body?.claimId;
            const claim =
                typeof id === 'string' && id.length <= 128
                    ? store.browserRequest(id)
                    : null;
            if (!claim) {
                res.sendStatus(404);
                return;
            }
            res.json(claim);
        }
    );
    router.post(
        '/device-pairing/device-approve',
        deviceApprover,
        (req, res) => {
            const id = req.body?.claimId;
            if (
                typeof id !== 'string' ||
                id.length > 128 ||
                !store.browserApprove(id)
            ) {
                res.sendStatus(404);
                return;
            }
            res.sendStatus(204);
        }
    );
    router.post('/device-pairing/invite', admin, (req, res) => {
        const origin = workerOnly ? req.body?.origin : undefined;
        if (workerOnly && (typeof origin !== 'string' || origin.length > 2048)) {
            res.sendStatus(400);
            return;
        }
        if (cloudflareAccess && origin !== ingress?.origin) {
            res.sendStatus(400);
            return;
        }
        const invite = store.invite(origin, !!cloudflareAccess);
        if (!invite) {
            res.sendStatus(429);
            return;
        }
        res.status(201).json(invite);
    });
    if (cloudflareAccess) {
        router.post('/device-pairing/cloudflare', registerCloudflareDevice(store, instanceId, cloudflareAccess));
        router.post('/device-pairing/cloudflare-invite', inviteFromCloudflareDevice(store, instanceId, cloudflareAccess));
    }
    router.post('/device-pairing/claim', (req, res) => {
        const { inviteId, name } = req.body ?? {};
        if (
            typeof inviteId !== 'string' ||
            inviteId.length > 128 ||
            typeof name !== 'string' ||
            !name.trim() ||
            name.trim().length > 80
        ) {
            res.sendStatus(400);
            return;
        }
        const claim = store.claim(
            inviteId,
            name.trim(),
            hostedIngressOrigin(req) ?? hostedLanOrigin(req)
        );
        if (!claim) {
            res.sendStatus(404);
            return;
        }
        res.status(201).json(claim);
    });
    router.post('/device-pairing/complete', (req, res) => {
        const { claimId, claimSecret } = req.body ?? {};
        if (
            typeof claimId !== 'string' ||
            claimId.length > 128 ||
            typeof claimSecret !== 'string' ||
            claimSecret.length > 128
        ) {
            res.sendStatus(400);
            return;
        }
        const result = store.complete(claimId, claimSecret);
        if (!result) {
            res.sendStatus(404);
            return;
        }
        res.json(
            result.status === 'approved' ? { ...result, instanceId } : result
        );
    });
    router.get('/devices', admin, (req, res) => {
        const invite = req.query.invite;
        res.json(store.list(
            !!cloudflareAccess,
            typeof invite === 'string' && /^[A-Za-z0-9_-]{43}$/.test(invite)
                ? invite
                : undefined
        ));
    });
    router.post('/device-pairing/approve', admin, (req, res) => {
        if (
            typeof req.body?.claimId !== 'string' ||
            req.body.claimId.length > 128
        ) {
            res.sendStatus(400);
            return;
        }
        if (!store.approve(req.body.claimId)) {
            res.sendStatus(404);
            return;
        }
        res.sendStatus(204);
    });
    router.put('/devices/:id/approval', admin, (req, res) => {
        if (typeof req.body?.canApprove !== 'boolean') {
            res.sendStatus(400);
            return;
        }
        if (!store.setApproval(String(req.params.id), req.body.canApprove, !!cloudflareAccess)) {
            res.sendStatus(404);
            return;
        }
        res.sendStatus(204);
    });
    router.delete('/devices/:id', admin, (req, res) => {
        if (!store.revoke(String(req.params.id), !!cloudflareAccess)) {
            res.sendStatus(404);
            return;
        }
        res.sendStatus(204);
    });
    return router;
}
