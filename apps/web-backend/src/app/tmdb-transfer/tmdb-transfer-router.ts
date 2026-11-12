import { randomBytes } from 'node:crypto';
import {
    isTmdbTransferCapability,
    isTmdbTransferKey,
    type TmdbTransferSession,
} from '@iptvnator/shared/interfaces';
import express, { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { StorageRequestError } from '../storage/storage-route-errors';

const TTL = 5 * 60_000;
const MAX_SESSIONS = 32;

interface Session extends Omit<TmdbTransferSession, 'expiresInMs'> {
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
    apiKey?: string;
}

/** Only the receiver can claim a key, and claiming removes it before replying. */
export function createTmdbTransferRouter(instanceId: string): Router {
    const router = Router();
    const receivers = new Map<string, Session>();
    const senders = new Map<string, Session>();
    const limitStart = rateLimit({
        windowMs: 60_000,
        limit: 6,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { code: 'transfer_busy' },
        keyGenerator: (req) =>
            ipKeyGenerator(req.socket.remoteAddress ?? 'unknown'),
    });
    const remove = (session: Session) => {
        clearTimeout(session.timer);
        receivers.delete(session.receiverToken);
        senders.delete(session.senderToken);
        delete session.apiKey;
    };

    router.post(
        '/tmdb-transfer',
        (req, res, next) => {
            res.set('Cache-Control', 'no-store');
            if (req.get('X-IPTVnator-Instance-Id') !== instanceId)
                throw new StorageRequestError(
                    409,
                    'instance_changed',
                    'The server identity changed.'
                );
            next();
        },
        express.json({ limit: '4kb', inflate: false }),
        (req, res, next) =>
            req.body?.action === 'start' ? limitStart(req, res, next) : next(),
        (req, res) => {
            const { action, transferToken, apiKey } = req.body ?? {};
            if (action === 'start') {
                if (receivers.size >= MAX_SESSIONS)
                    throw new StorageRequestError(
                        429,
                        'transfer_busy',
                        'Too many transfers. Try again shortly.'
                    );
                const session: Session = {
                    receiverToken: randomBytes(24).toString('base64url'),
                    senderToken: randomBytes(24).toString('base64url'),
                    expiresAt: Date.now() + TTL,
                    timer: setTimeout(() => remove(session), TTL).unref(),
                };
                receivers.set(session.receiverToken, session);
                senders.set(session.senderToken, session);
                const { receiverToken, senderToken } = session;
                res.status(201).json({
                    receiverToken,
                    senderToken,
                    expiresInMs: TTL,
                });
                return;
            }

            const sender = action === 'check' || action === 'send';
            const session = isTmdbTransferCapability(transferToken)
                ? (sender ? senders : receivers).get(transferToken)
                : undefined;
            if (!session || session.expiresAt <= Date.now()) {
                if (session) remove(session);
                throw new StorageRequestError(
                    410,
                    'transfer_closed',
                    'This transfer code is invalid, expired or already used.'
                );
            }
            switch (action) {
                case 'check':
                case 'status':
                    res.json({ status: session.apiKey ? 'ready' : 'waiting' });
                    return;
                case 'send':
                    if (session.apiKey)
                        throw new StorageRequestError(
                            409,
                            'transfer_used',
                            'A key has already been sent.'
                        );
                    if (!isTmdbTransferKey(apiKey)) break;
                    session.apiKey = apiKey;
                    res.json({ status: 'ready' });
                    return;
                case 'claim': {
                    const key = session.apiKey;
                    if (!key)
                        throw new StorageRequestError(
                            409,
                            'transfer_waiting',
                            'No key has been sent yet.'
                        );
                    remove(session);
                    res.json({ apiKey: key });
                    return;
                }
                case 'cancel':
                    remove(session);
                    res.json({ status: 'cancelled' });
                    return;
            }
            throw new StorageRequestError(
                400,
                'invalid_transfer',
                'Invalid transfer request.'
            );
        }
    );
    return router;
}
