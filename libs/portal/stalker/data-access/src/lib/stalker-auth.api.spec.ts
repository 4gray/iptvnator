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
