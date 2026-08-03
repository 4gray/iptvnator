import type { DataService } from '@iptvnator/services';
import type { createLogger } from '@iptvnator/portal/shared/util';
import { StalkerAuthApi } from './stalker-auth.api';

/**
 * Client-side mirror of the mock server's `auth-handlers.spec.ts`: the same
 * documented flows — status 2 → do_auth → profile retry, blocked profiles,
 * idempotent token reuse, not_valid propagation — asserted against the
 * requests the client actually sends.
 */
describe('StalkerAuthApi', () => {
    const portalUrl =
        'https://portal.example.com/stalker_portal/server/load.php';
    const macAddress = '00:1A:79:AA:BB:CC';

    let sendIpcEvent: jest.Mock;
    let api: StalkerAuthApi;

    const logger = {
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    } as unknown as ReturnType<typeof createLogger>;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                subtle: {
                    digest: jest.fn(
                        async () => new Uint8Array(20).fill(1).buffer
                    ),
                },
            },
        });

        sendIpcEvent = jest.fn();
        api = new StalkerAuthApi(
            { sendIpcEvent } as unknown as DataService,
            logger
        );
    });

    function callsByAction(action: string) {
        return sendIpcEvent.mock.calls.filter(
            (call) => call[1].params.action === action
        );
    }

    it('walks the login-required flow: status 2 -> do_auth -> profile retry', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1', not_valid: 0 },
            })
            .mockResolvedValueOnce({
                js: { status: 2, template: 'auth', info: 'Login required' },
            })
            .mockResolvedValueOnce({ js: true })
            .mockResolvedValueOnce({
                js: { status: 0, watchdog_timeout: 120, timeslot: 15 },
            });

        const result = await api.authenticate(
            portalUrl,
            macAddress,
            { deviceId1: 'DEV-1', deviceId2: 'DEV-2' },
            { credentials: { username: 'user', password: 'secret' } }
        );

        expect(result.token).toBe('TOKEN-1');
        expect(result.watchdogTimeoutSeconds).toBe(120);
        expect(result.timeslotSeconds).toBe(15);

        // First profile request is NOT the second auth step.
        const profiles = callsByAction('get_profile');
        expect(profiles).toHaveLength(2);
        expect(profiles[0][1].params.auth_second_step).toBe('0');
        // The retry after do_auth is.
        expect(profiles[1][1].params.auth_second_step).toBe('1');

        // do_auth carries the credentials and the device identity.
        const doAuth = callsByAction('do_auth');
        expect(doAuth).toHaveLength(1);
        expect(doAuth[0][1].params).toEqual(
            expect.objectContaining({
                login: 'user',
                password: 'secret',
                device_id: 'DEV-1',
                device_id2: 'DEV-2',
            })
        );
    });

    it('throws login-required when the portal wants credentials and none are stored', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({ js: { status: 2 } });

        await expect(
            api.authenticate(portalUrl, macAddress)
        ).rejects.toMatchObject({
            name: 'StalkerPortalError',
            kind: 'login-required',
        });
        // Empty credentials are never sent to the billing script.
        expect(callsByAction('do_auth')).toHaveLength(0);
    });

    it('throws login-rejected when do_auth answers {js:false}', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({ js: { status: 2 } })
            .mockResolvedValueOnce({ js: false });

        await expect(
            api.authenticate(portalUrl, macAddress, {}, {
                credentials: { username: 'user', password: 'wrong' },
            })
        ).rejects.toMatchObject({ kind: 'login-rejected' });
    });

    it('throws login-rejected when the profile still demands a login after do_auth', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({ js: { status: 2 } })
            .mockResolvedValueOnce({ js: true })
            .mockResolvedValueOnce({ js: { status: 2 } });

        await expect(
            api.authenticate(portalUrl, macAddress, {}, {
                credentials: { username: 'user', password: 'secret' },
            })
        ).rejects.toMatchObject({ kind: 'login-rejected' });
    });

    it('carries the portal explanation out of every login refusal', async () => {
        // The actionable sentence ("wrong password", "subscription expired")
        // rides along with the refusal, and the dialog renders it after the
        // generic line. Each exit must read the response IN HAND: the retry
        // explains its own rejection, and quoting the first profile back
        // would describe a request that already succeeded.
        const handshake = { js: { token: 'TOKEN-1', random: 'r1' } };
        const credentials = { username: 'user', password: 'secret' };

        sendIpcEvent
            .mockResolvedValueOnce(handshake)
            .mockResolvedValueOnce({
                js: { status: 2, msg: 'Enter your subscriber login' },
            });
        await expect(
            api.authenticate(portalUrl, macAddress)
        ).rejects.toMatchObject({
            kind: 'login-required',
            portalText: 'Enter your subscriber login',
        });

        sendIpcEvent
            .mockResolvedValueOnce(handshake)
            .mockResolvedValueOnce({ js: { status: 2, msg: 'Login needed' } })
            .mockResolvedValueOnce({ js: false });
        await expect(
            api.authenticate(portalUrl, macAddress, {}, { credentials })
        ).rejects.toMatchObject({
            kind: 'login-rejected',
            portalText: 'Login needed',
        });

        sendIpcEvent
            .mockResolvedValueOnce(handshake)
            .mockResolvedValueOnce({ js: { status: 2, msg: 'Login needed' } })
            .mockResolvedValueOnce({ js: true })
            .mockResolvedValueOnce({
                js: { status: 2, block_msg: 'Subscription expired' },
            });
        await expect(
            api.authenticate(portalUrl, macAddress, {}, { credentials })
        ).rejects.toMatchObject({
            kind: 'login-rejected',
            // The retry's text, not the first profile's.
            portalText: 'Subscription expired',
        });
    });

    it('decodes a blocked profile into the portal explanation', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({
                js: {
                    status: 1,
                    msg: 'device conflict - device_id mismatch',
                    block_msg: 'Your STB is damaged.<br/> Call the provider.',
                },
            });

        await expect(
            api.authenticate(portalUrl, macAddress)
        ).rejects.toMatchObject({
            kind: 'blocked',
            portalText:
                'device conflict - device_id mismatch — Your STB is damaged. Call the provider.',
        });
    });

    it('treats a bare {status:1} profile as refused', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({ js: { status: 1 } });

        await expect(
            api.authenticate(portalUrl, macAddress)
        ).rejects.toMatchObject({ kind: 'blocked' });
    });

    it('propagates the handshake not_valid flag into not_valid_token', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'NEW-TOKEN', random: 'r1', not_valid: 1 },
            })
            .mockResolvedValueOnce({ js: { status: 0 } });

        await api.authenticate(portalUrl, macAddress, {}, {
            storedToken: 'STALE-TOKEN',
        });

        const profile = callsByAction('get_profile')[0][1];
        expect(profile.params.not_valid_token).toBe('1');
    });

    it('re-presents a stored token and skips get_profile when it comes back unchanged', async () => {
        sendIpcEvent.mockResolvedValueOnce({
            js: { token: 'STORED-TOKEN', random: 'r1', not_valid: 0 },
        });

        const result = await api.authenticate(portalUrl, macAddress, {}, {
            storedToken: 'STORED-TOKEN',
            skipProfileWhenReused: true,
        });

        expect(result).toEqual({
            token: 'STORED-TOKEN',
            reusedStoredToken: true,
        });
        expect(callsByAction('handshake')[0][1].params.token).toBe(
            'STORED-TOKEN'
        );
        expect(callsByAction('get_profile')).toHaveLength(0);
    });

    it('runs the full profile when the portal replaces a stale stored token', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'FRESH-TOKEN', random: 'r1', not_valid: 1 },
            })
            .mockResolvedValueOnce({ js: { status: 0 } });

        const result = await api.authenticate(portalUrl, macAddress, {}, {
            storedToken: 'STALE-TOKEN',
            skipProfileWhenReused: true,
        });

        expect(result.token).toBe('FRESH-TOKEN');
        expect(result.reusedStoredToken).toBe(false);
        expect(callsByAction('get_profile')).toHaveLength(1);
    });

    it('does not reuse an echoed token the portal flagged not_valid', async () => {
        // `not_valid: 1` is the portal saying the presented token is not a
        // live session. Adopting it because the string matched would be
        // unrecoverable: nothing writes a replacement back, so every later
        // start would re-present the same dead token.
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'STORED-TOKEN', random: 'r1', not_valid: 1 },
            })
            .mockResolvedValueOnce({ js: { status: 0 } });

        const result = await api.authenticate(portalUrl, macAddress, {}, {
            storedToken: 'STORED-TOKEN',
            skipProfileWhenReused: true,
        });

        expect(result.reusedStoredToken).toBe(false);
        expect(callsByAction('get_profile')).toHaveLength(1);
        expect(callsByAction('get_profile')[0][1].params.not_valid_token).toBe(
            '1'
        );
    });

    it('decodes a stringified status 2 into the login flow', async () => {
        // Portals routinely stringify numeric fields — the same reason
        // watchdog_timeout/timeslot accept strings. A strict === would read
        // "2" as a healthy profile and skip do_auth entirely.
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({ js: { status: '2' } })
            .mockResolvedValueOnce({ js: true })
            .mockResolvedValueOnce({ js: { status: '0' } });

        const result = await api.authenticate(portalUrl, macAddress, {}, {
            credentials: { username: 'user', password: 'secret' },
        });

        expect(result.token).toBe('TOKEN-1');
        expect(callsByAction('do_auth')).toHaveLength(1);
        expect(
            callsByAction('get_profile')[1][1].params.auth_second_step
        ).toBe('1');
    });

    it('decodes a stringified status 1 as a refusal', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({ js: { status: '1' } });

        await expect(
            api.authenticate(portalUrl, macAddress)
        ).rejects.toMatchObject({ kind: 'blocked' });
    });

    it('never sends get_profile once the caller abandoned the attempt', async () => {
        // The harm this prevents: `get_profile` is what adopts a token for
        // the MAC portal-side, so an abandoned discovery attempt reaching it
        // after another candidate authenticated would invalidate that
        // healthy candidate's token.
        const abandon = new AbortController();
        sendIpcEvent.mockImplementationOnce(async () => {
            abandon.abort();
            return { js: { token: 'TOKEN-1', random: 'r1' } };
        });

        await expect(
            api.authenticate(portalUrl, macAddress, {}, {
                signal: abandon.signal,
            })
        ).rejects.toMatchObject({ name: 'StalkerAuthAbortedError' });

        expect(callsByAction('handshake')).toHaveLength(1);
        expect(callsByAction('get_profile')).toHaveLength(0);
    });

    it('does not even handshake when already abandoned', async () => {
        const abandon = new AbortController();
        abandon.abort();

        await expect(
            api.authenticate(portalUrl, macAddress, {}, {
                signal: abandon.signal,
            })
        ).rejects.toMatchObject({ name: 'StalkerAuthAbortedError' });

        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it('rechecks the abort after the async prehash, not just before the call', async () => {
        // getProfile awaits generatePrehash(); an abort landing during that
        // await would otherwise still let the adopting request go out.
        const abandon = new AbortController();
        const digest = globalThis.crypto.subtle.digest as jest.Mock;
        digest.mockImplementation(async () => {
            abandon.abort();
            return new Uint8Array(20).fill(1).buffer;
        });

        await expect(
            api.getProfile(portalUrl, macAddress, 'TOKEN-1', {}, 'r1', {
                signal: abandon.signal,
            })
        ).rejects.toMatchObject({ name: 'StalkerAuthAbortedError' });

        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it('stops the status-2 login flow when abandoned mid-way', async () => {
        const abandon = new AbortController();
        sendIpcEvent
            .mockResolvedValueOnce({ js: { token: 'TOKEN-1', random: 'r1' } })
            .mockImplementationOnce(async () => {
                abandon.abort();
                return { js: { status: 2 } };
            });

        await expect(
            api.authenticate(portalUrl, macAddress, {}, {
                credentials: { username: 'user', password: 'secret' },
                signal: abandon.signal,
            })
        ).rejects.toMatchObject({ name: 'StalkerAuthAbortedError' });

        expect(callsByAction('do_auth')).toHaveLength(0);
    });

    it('classifies a transport auth-failure marker during get_profile', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: { token: 'TOKEN-1', random: 'r1' },
            })
            .mockResolvedValueOnce({
                stalkerAuthFailure: 'Unauthorized request.',
            });

        await expect(
            api.authenticate(portalUrl, macAddress)
        ).rejects.toMatchObject({
            kind: 'auth-failed',
            failureBody: 'Unauthorized request.',
        });
    });
});
