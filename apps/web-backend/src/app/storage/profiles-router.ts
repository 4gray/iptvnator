import express, { Router, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import {
    DEFAULT_PROFILE_ID,
    PROFILE_LIMIT,
    type ServerProfile,
} from '@iptvnator/shared/interfaces/profiles';
import { matchesEtag } from './etag-match';
import {
    missingProfile,
    objectBody,
    optionalBoolean,
    optionalColour,
    optionalEmoji,
    optionalObjectBody,
    optionalPin,
    requireName,
    requireNoKidsPin,
} from './profile-input';
import { hashProfilePin } from './profile-pin';
import { PinLockedError, ProfilePinAttempts } from './profile-pin-attempts';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

/** PIN attempts per client per minute, across all profiles and routes. */
const UNLOCK_ATTEMPTS_PER_MINUTE = 30;

/**
 * `/v1/profiles`: the people of the household. Behind the access guard like
 * every storage route. A PIN is a light lock: the server checks it before the
 * PIN is changed or removed and before the profile is deleted, but anyone
 * with the access token can still read and write every scope.
 */
export function createProfilesRouter(
    storage: ServerStorage,
    attempts = new ProfilePinAttempts()
): Router {
    const router = Router();
    const profiles = storage.profiles;

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
    // The per-profile lockout stops guessing one PIN; this caps a client
    // trying PINs across every profile.
    const pinLimit = rateLimit({
        windowMs: 60_000,
        limit: UNLOCK_ATTEMPTS_PER_MINUTE,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        // Not client-supplied forwarding headers: proxy peers share a budget.
        keyGenerator: (req) =>
            ipKeyGenerator(req.socket.remoteAddress ?? 'unknown'),
        message: {
            code: 'pin_rate_limited',
            message: 'Too many PIN attempts. Try again shortly.',
        },
    });
    // Creates, edits and deletes share the budget when they carry a PIN,
    // so they are no way around it and cannot queue up scrypt work.
    const pinLimitIfPin: express.RequestHandler = (req, res, next) => {
        const body = req.body as Record<string, unknown> | undefined;
        if (
            body &&
            typeof body === 'object' &&
            ('currentPin' in body || 'pin' in body)
        ) {
            return pinLimit(req, res, next);
        }
        next();
    };

    router.get('/profiles', (req, res) => sendList(req, res));

    // One switch for the household, so every device agrees whether
    // profiles are on. Turning it off deletes nothing.
    router.patch('/profiles', (req, res) => {
        const enabled = objectBody(req)['enabled'];
        if (typeof enabled !== 'boolean') {
            throw new StorageRequestError(
                400,
                'invalid_profiles_setting',
                'Expected { enabled: boolean }.'
            );
        }
        profiles.household.setEnabled(enabled);
        sendList(req, res);
    });

    // The full list of ids in the new order. Default stays first; it may
    // lead the list or be left out.
    router.put('/profiles/order', (req, res) => {
        const ids = objectBody(req)['ids'];
        if (
            !Array.isArray(ids) ||
            ids.length > PROFILE_LIMIT ||
            ids.some((id) => typeof id !== 'string')
        ) {
            throw new StorageRequestError(
                400,
                'invalid_profile_order',
                'Expected { ids: string[] }.'
            );
        }
        const others = ids[0] === DEFAULT_PROFILE_ID ? ids.slice(1) : ids;
        if (!profiles.reorder(others as string[])) {
            throw new StorageRequestError(
                409,
                'profile_order_mismatch',
                'Send every profile id once; the list may be out of date.'
            );
        }
        sendList(req, res);
    });

    router.post('/profiles', pinLimitIfPin, async (req, res) => {
        const body = objectBody(req);
        const name = requireName(body['name']);
        const colour = optionalColour(body['colour']);
        const emoji = optionalEmoji(body['emoji']) ?? undefined;
        const pin = optionalPin(body['pin']);
        const kids = optionalBoolean(body['kids'], 'kids') ?? false;
        requireNoKidsPin(kids, !!pin);
        // Checked before hashing, so a refused create costs no scrypt work,
        // and again right before the synchronous write, so overlapping
        // requests cannot both pass them.
        requireRoomFor(name);
        const pinHash = pin ? await hashProfilePin(pin) : null;
        requireRoomFor(name);
        res.status(201).json(
            profiles.create({ name, colour, emoji, pinHash, kids })
        );
    });

    router.patch('/profiles/:id', pinLimitIfPin, async (req, res) => {
        const id = String(req.params['id']);
        requireProfile(id);
        const body = objectBody(req);
        const name =
            body['name'] === undefined ? undefined : requireName(body['name']);
        const colour = optionalColour(body['colour']);
        const emoji = optionalEmoji(body['emoji']);
        const changesPin = body['pin'] !== undefined;
        const newPin = body['pin'] === null ? null : optionalPin(body['pin']);
        const kids = optionalBoolean(body['kids'], 'kids');
        // Default holds the shared data older clients show; locking it
        // would surprise people on those devices.
        if (kids && id === DEFAULT_PROFILE_ID) {
            throw new StorageRequestError(
                400,
                'default_profile_kids',
                'The Default profile cannot be a kids profile.'
            );
        }
        // Changing or removing a PIN takes the current one.
        const stored = profiles.pinHashOf(id);
        const kidsPin = () =>
            requireNoKidsPin(
                kids ?? requireProfile(id).kids,
                changesPin ? newPin !== null : !!profiles.pinHashOf(id)
            );
        kidsPin();
        if (changesPin && stored) {
            await checkPin(res, id, body['currentPin'], stored);
        }
        let pinHash: string | null | undefined;
        if (changesPin) pinHash = newPin ? await hashProfilePin(newPin) : null;
        // Rechecked after the awaits: the profile may have been deleted, its
        // PIN changed or the name taken in the meantime.
        requireProfile(id);
        if (changesPin) requireSamePin(id, stored);
        kidsPin();
        if (name !== undefined) requireFreeName(name, id);
        const updated = profiles.update(id, {
            name,
            colour,
            emoji,
            pinHash,
            kids,
        });
        if (!updated) throw missingProfile();
        res.json(updated);
    });

    router.delete('/profiles/:id', pinLimitIfPin, async (req, res) => {
        const id = String(req.params['id']);
        if (id === DEFAULT_PROFILE_ID) {
            throw new StorageRequestError(
                400,
                'default_profile',
                'The Default profile cannot be deleted.'
            );
        }
        const body = optionalObjectBody(req);
        requireProfile(id);
        // Deleting a PIN-protected profile takes its PIN.
        const stored = profiles.pinHashOf(id);
        if (stored) {
            await checkPin(res, id, body['currentPin'], stored);
            requireSamePin(id, stored);
        }
        if (!profiles.delete(id)) throw missingProfile();
        attempts.clear(id);
        res.status(204).end();
    });

    router.post('/profiles/:id/unlock', pinLimit, async (req, res) => {
        const id = String(req.params['id']);
        requireProfile(id);
        const pin = objectBody(req)['pin'];
        const stored = profiles.pinHashOf(id);
        if (!stored) {
            res.json({ unlocked: true });
            return;
        }
        await checkPin(res, id, pin, stored);
        res.json({ unlocked: true });
    });

    function requireRoomFor(name: string): void {
        if (profiles.count() >= PROFILE_LIMIT) {
            throw new StorageRequestError(
                409,
                'profile_limit',
                `A household has at most ${PROFILE_LIMIT} profiles.`
            );
        }
        requireFreeName(name);
    }

    /**
     * The list with its revision as the ETag. A matching `If-None-Match`
     * gets `304`, so clients can poll cheaply for renames and new profiles.
     */
    function sendList(req: Request, res: Response): void {
        const list = profiles.snapshot();
        const etag = `"profiles-${list.revision}"`;
        res.set({
            ETag: etag,
            // Revalidated on every use; there is no PIN data in the list.
            'Cache-Control': 'no-cache',
            'Access-Control-Expose-Headers': 'ETag',
        });
        if (
            req.method === 'GET' &&
            matchesEtag(req.get('if-none-match'), etag)
        ) {
            res.status(304).end();
            return;
        }
        res.json(list);
    }

    /**
     * Checks a PIN, counting a wrong one towards the profile's lock. A
     * missing PIN is refused without counting: nothing was guessed.
     */
    async function checkPin(
        res: Response,
        id: string,
        pin: unknown,
        stored: string
    ): Promise<void> {
        if (pin === undefined) {
            throw new StorageRequestError(
                403,
                'pin_required',
                'This profile has a PIN. Send it as currentPin.'
            );
        }
        try {
            // The PIN may change, or the profile go, while scrypt runs: a
            // gone profile is 404, a PIN that changed counts as wrong.
            await attempts.verify(id, pin, stored, () => {
                requireProfile(id);
                return profiles.pinHashOf(id) === stored;
            });
        } catch (error) {
            if (error instanceof PinLockedError) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }
            throw error;
        }
    }

    function requireSamePin(id: string, stored: string | null): void {
        if (profiles.pinHashOf(id) !== stored) {
            throw new StorageRequestError(
                409,
                'pin_changed',
                'The PIN changed in the meantime. Try again.'
            );
        }
    }

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
        if (!profile) throw missingProfile();
        return profile;
    }

    return router;
}
