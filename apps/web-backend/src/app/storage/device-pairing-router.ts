import express, { type RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { DevicePairingStore } from './device-pairing-store';
import { matchesAccessToken } from './access-guard';

/** Mounted before the main guard; admin requires both the shared token and local listener. */
export function createDevicePairingRouter(
    store: DevicePairingStore,
    sharedToken: string,
    instanceId: string
) {
    const router = express.Router();
    router.use((_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    router.use(
        rateLimit({
            windowMs: 60_000,
            limit: 120,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            keyGenerator: (req) =>
                ipKeyGenerator(req.socket.remoteAddress ?? 'unknown'),
        })
    );
    router.use(express.json({ limit: '4kb' }));
    const admin: RequestHandler = (req, res, next) => {
        const local =
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
    router.post('/device-pairing/invite', admin, (_req, res) => {
        const invite = store.invite();
        if (!invite) {
            res.sendStatus(429);
            return;
        }
        res.status(201).json(invite);
    });
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
        const claim = store.claim(inviteId, name.trim());
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
    router.get('/devices', admin, (_req, res) => res.json(store.list()));
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
    router.delete('/devices/:id', admin, (req, res) => {
        if (!store.revoke(String(req.params.id))) {
            res.sendStatus(404);
            return;
        }
        res.sendStatus(204);
    });
    return router;
}
