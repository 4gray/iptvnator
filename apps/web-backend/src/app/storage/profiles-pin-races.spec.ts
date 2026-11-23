import express from 'express';
import { withServer } from '../web-backend-app.spec-helpers';
import { withTempStorage } from './server-storage.spec-helpers';
import { createProfilesRouter } from './profiles-router';
import * as profilePin from './profile-pin';
import { ProfilePinAttempts } from './profile-pin-attempts';
import { storageErrorHandler } from './storage-route-errors';
import type { ServerStorage } from './server-storage';

/** A verifier that holds its first check until released. */
function heldVerifier() {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const verify = async (pin: string, stored: string) => {
        if (first) {
            first = false;
            entered();
            await gate;
        }
        return profilePin.verifyProfilePin(pin, stored);
    };
    return { verify, started, release };
}

function app(storage: ServerStorage, attempts: ProfilePinAttempts) {
    const server = express();
    server.use('/v1', createProfilesRouter(storage, attempts));
    server.use('/v1', storageErrorHandler());
    return server;
}

const unlock = (baseUrl: string, storage: ServerStorage, id: string) =>
    fetch(`${baseUrl}/v1/profiles/${id}/unlock`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-iptvnator-instance-id': storage.database.instanceId,
        },
        body: JSON.stringify({ pin: '1234' }),
    });

const codeOf = async (response: Response) =>
    ((await response.json()) as { code: string }).code;

describe('profile PIN races', () => {
    it('does not unlock with a PIN replaced while it was checked', () =>
        withTempStorage(async (storage) => {
            const held = heldVerifier();
            const attempts = new ProfilePinAttempts(Date.now, held.verify);
            const { id } = storage.profiles.create({
                name: 'Robin',
                pinHash: await profilePin.hashProfilePin('1234'),
            });
            await withServer(app(storage, attempts), async (baseUrl) => {
                const pending = unlock(baseUrl, storage, id);
                await held.started;
                storage.profiles.update(id, {
                    pinHash: await profilePin.hashProfilePin('9999'),
                });
                held.release();
                const response = await pending;
                expect(response.status).toBe(403);
                expect(await codeOf(response)).toBe('wrong_pin');
            });
        }));

    it('does not unlock a profile deleted while its PIN was checked', () =>
        withTempStorage(async (storage) => {
            const held = heldVerifier();
            const attempts = new ProfilePinAttempts(Date.now, held.verify);
            const { id } = storage.profiles.create({
                name: 'Robin',
                pinHash: await profilePin.hashProfilePin('1234'),
            });
            await withServer(app(storage, attempts), async (baseUrl) => {
                const pending = unlock(baseUrl, storage, id);
                await held.started;
                storage.profiles.delete(id);
                held.release();
                const response = await pending;
                expect(response.status).toBe(404);
                expect(await codeOf(response)).toBe('profile_missing');
            });
        }));
});
