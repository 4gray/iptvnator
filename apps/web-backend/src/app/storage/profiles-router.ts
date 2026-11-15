import express, { Router, type Request } from 'express';
import {
    DEFAULT_PROFILE_ID,
    PROFILE_LIMIT,
    PROFILE_NAME_MAX_LENGTH,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces';
import { hashProfilePin, PROFILE_PIN, verifyProfilePin } from './profile-pin';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

const COLOUR = /^#[0-9a-f]{6}$/;
/** Wrong PINs in a row before a profile is locked for a while. */
const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 30_000;

/**
 * `/v1/profiles`: the people of the household. Behind the access guard like
 * every storage route; a PIN only stops picking someone else's profile by
 * accident.
 */
export function createProfilesRouter(storage: ServerStorage): Router {
    const router = Router();
    const profiles = storage.profiles;
    const failures = new Map<string, { count: number; until: number }>();

    router.use('/profiles', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (
            req.get('x-iptvnator-instance-id') !== storage.database.instanceId
        ) {
            throw new StorageRequestError(
                409,
                'instance_changed',
                'Verify the server identity before changing profiles.'
            );
        }
        next();
    });
    router.use('/profiles', express.json({ limit: 4 * 1024 }));

    router.get('/profiles', (_req, res) => {
        const body: ServerProfileList = { profiles: profiles.list() };
        res.json(body);
    });

    router.post('/profiles', async (req, res) => {
        const body = objectBody(req);
        const name = requireName(body['name']);
        const colour = optionalColour(body['colour']);
        const pin = optionalPin(body['pin']);
        const pinHash = pin ? await hashProfilePin(pin) : null;
        // Checked after hashing, right before the synchronous write, so
        // overlapping requests cannot both pass them.
        if (profiles.count() >= PROFILE_LIMIT) {
            throw new StorageRequestError(
                409,
                'profile_limit',
                `A household has at most ${PROFILE_LIMIT} profiles.`
            );
        }
        requireFreeName(name);
        res.status(201).json(profiles.create(name, colour, pinHash));
    });

    router.patch('/profiles/:id', async (req, res) => {
        const id = String(req.params['id']);
        requireProfile(id);
        const body = objectBody(req);
        const name =
            body['name'] === undefined ? undefined : requireName(body['name']);
        const colour = optionalColour(body['colour']);
        let pinHash: string | null | undefined;
        if (body['pin'] === null) pinHash = null;
        else if (body['pin'] !== undefined) {
            pinHash = await hashProfilePin(optionalPin(body['pin']) as string);
        }
        // Rechecked after hashing: the profile may have been deleted, or the
        // name taken, while the hash was computed.
        requireProfile(id);
        if (name !== undefined) requireFreeName(name, id);
        const updated = profiles.update(id, { name, colour, pinHash });
        if (!updated) throw missing();
        // A new or removed PIN ends a lockout; other edits leave it running.
        if (pinHash !== undefined) failures.delete(id);
        res.json(updated);
    });

    router.delete('/profiles/:id', (req, res) => {
        const id = String(req.params['id']);
        if (id === DEFAULT_PROFILE_ID) {
            throw new StorageRequestError(
                400,
                'default_profile',
                'The Default profile cannot be deleted.'
            );
        }
        if (!profiles.delete(id)) throw missing();
        failures.delete(id);
        res.status(204).end();
    });

    router.post('/profiles/:id/unlock', async (req, res) => {
        const id = String(req.params['id']);
        requireProfile(id);
        const pin = objectBody(req)['pin'];
        const stored = profiles.pinHashOf(id);
        if (!stored) {
            res.json({ unlocked: true });
            return;
        }
        const now = Date.now();
        const state = failures.get(id);
        if (state && state.until > now) {
            res.set(
                'Retry-After',
                String(Math.ceil((state.until - now) / 1000))
            );
            throw new StorageRequestError(
                429,
                'pin_locked',
                'Too many wrong PINs. Try again shortly.'
            );
        }
        // Every attempt counts before the PIN is checked, so overlapping
        // guesses cannot all start from the same count. A lockout that has
        // run out starts the count again.
        const expired = !!state?.until && state.until <= now;
        const count = (expired ? 0 : (state?.count ?? 0)) + 1;
        failures.set(id, {
            count,
            until: count >= MAX_PIN_FAILURES ? now + PIN_LOCK_MS : 0,
        });
        const ok =
            typeof pin === 'string' &&
            PROFILE_PIN.test(pin) &&
            (await verifyProfilePin(pin, stored));
        if (!ok) {
            throw new StorageRequestError(403, 'wrong_pin', 'Wrong PIN.');
        }
        failures.delete(id);
        res.json({ unlocked: true });
    });

    function requireFreeName(name: string, exceptId?: string): void {
        if (profiles.nameTaken(name, exceptId)) {
            throw new StorageRequestError(
                409,
                'profile_name_taken',
                'Another profile already has this name.'
            );
        }
    }

    function requireProfile(id: string): ServerProfile {
        const profile = profiles.get(id);
        if (!profile) throw missing();
        return profile;
    }

    return router;
}

function missing(): StorageRequestError {
    return new StorageRequestError(
        404,
        'profile_missing',
        'The profile does not exist.'
    );
}

function objectBody(req: Request): Record<string, unknown> {
    const body = req.body as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new StorageRequestError(
            400,
            'invalid_body',
            'Expected a JSON object.'
        );
    }
    return body as Record<string, unknown>;
}

function requireName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (
        !name ||
        name.length > PROFILE_NAME_MAX_LENGTH ||
        Array.from(name).some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
        )
    ) {
        throw new StorageRequestError(
            400,
            'invalid_profile_name',
            `A profile name has 1 to ${PROFILE_NAME_MAX_LENGTH} characters.`
        );
    }
    return name;
}

function optionalColour(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !COLOUR.test(value.toLowerCase())) {
        throw new StorageRequestError(
            400,
            'invalid_profile_colour',
            'A profile colour is #rrggbb.'
        );
    }
    return value.toLowerCase();
}

function optionalPin(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !PROFILE_PIN.test(value)) {
        throw new StorageRequestError(
            400,
            'invalid_pin',
            'A PIN has 4 to 8 digits.'
        );
    }
    return value;
}
