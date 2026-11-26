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

/** A verifier that holds `count` checks, after `skip` that pass straight through, until released. */
function gatedVerifier(count: number, skip = 0) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered = 0;
    let seen = 0;
    let allEntered!: () => void;
    const started = new Promise<void>((resolve) => (allEntered = resolve));
    const verify = async (pin: string, stored: string) => {
        if (seen++ >= skip && entered < count) {
            entered++;
            if (entered === count) allEntered();
            await gate;
        }
        return profilePin.verifyProfilePin(pin, stored);
    };
    return { verify, started, release };
}

const unlock = (
    baseUrl: string,
    storage: ServerStorage,
    id: string,
    pin = '1234'
) =>
    fetch(`${baseUrl}/v1/profiles/${id}/unlock`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-iptvnator-instance-id': storage.database.instanceId,
        },
        body: JSON.stringify({ pin }),
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

    it('never counts overlapping correct PINs towards the lockout', () =>
        withTempStorage(async (storage) => {
            const held = gatedVerifier(1, 4);
            const attempts = new ProfilePinAttempts(Date.now, held.verify);
            const { id } = storage.profiles.create({
                name: 'Robin',
                pinHash: await profilePin.hashProfilePin('1234'),
            });
            await withServer(app(storage, attempts), async (baseUrl) => {
                const status = async (pin: string) =>
                    (await unlock(baseUrl, storage, id, pin)).status;
                // Four wrong PINs leave one attempt. Two correct checks at
                // once would use it up if a check in flight counted.
                for (let i = 0; i < 4; i++)
                    expect(await status('0000')).toBe(403);
                const first = unlock(baseUrl, storage, id);
                const second = unlock(baseUrl, storage, id);
                await held.started;
                held.release();
                expect((await first).status).toBe(200);
                expect((await second).status).toBe(200);
                // The correct PIN started the count again: four wrong PINs
                // are still answered as wrong, not locked.
                for (let i = 0; i < 4; i++)
                    expect(await status('0000')).toBe(403);
            });
        }));

    it('does not lock a correct PIN that overlaps wrong ones', () =>
        withTempStorage(async (storage) => {
            const held = gatedVerifier(3);
            const attempts = new ProfilePinAttempts(Date.now, held.verify);
            const { id } = storage.profiles.create({
                name: 'Robin',
                pinHash: await profilePin.hashProfilePin('1234'),
            });
            await withServer(app(storage, attempts), async (baseUrl) => {
                const correct = unlock(baseUrl, storage, id);
                const wrongA = unlock(baseUrl, storage, id, '0000');
                const wrongB = unlock(baseUrl, storage, id, '1111');
                await held.started;
                held.release();
                expect((await correct).status).toBe(200);
                expect((await wrongA).status).toBe(403);
                expect((await wrongB).status).toBe(403);
                // The correct PIN is accepted again straight away.
                expect((await unlock(baseUrl, storage, id)).status).toBe(200);
            });
        }));
});
