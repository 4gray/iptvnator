import { Request } from 'express';
import {
    adoptToken,
    checkRequestAuthorization,
    hasCompletedDoAuth,
    invalidateSession,
    issueHandshakeToken,
    markDoAuthCompleted,
    pinDeviceIdentity,
    readBearerToken,
    resetAuthState,
} from './auth-store';

const MAC = '00:1A:79:AA:BB:CC';

function request(options: {
    action?: string;
    mac?: string | null;
    token?: string;
}): Request {
    const headers: Record<string, string> = {};
    if (options.mac !== null) {
        headers['cookie'] = `mac=${options.mac ?? MAC}; stb_lang=en`;
    }
    if (options.token) {
        headers['authorization'] = `Bearer ${options.token}`;
    }
    return {
        headers,
        query: { action: options.action ?? 'get_categories' },
    } as unknown as Request;
}

describe('stalker mock auth store', () => {
    beforeEach(() => {
        resetAuthState();
    });

    it('issues a 32-char uppercase hex token', () => {
        const { token } = issueHandshakeToken(MAC);

        expect(token).toMatch(/^[0-9A-F]{32}$/);
    });

    it('returns the stored token unchanged when it is presented again', () => {
        const { token } = issueHandshakeToken(MAC);
        adoptToken(MAC, token);

        const second = issueHandshakeToken(MAC, token);

        expect(second.token).toBe(token);
        expect(second.notValid).toBe(false);
    });

    it('flags not_valid when a stale token is presented', () => {
        expect(issueHandshakeToken(MAC, 'STALE').notValid).toBe(true);
    });

    it('rejects a request without a mac cookie', () => {
        expect(checkRequestAuthorization(request({ mac: null }), true)).toBe(
            'Unauthorized request.'
        );
    });

    it('rejects an unauthenticated action when enforcement is on', () => {
        expect(checkRequestAuthorization(request({}), true)).toBe(
            'Authorization failed.'
        );
    });

    it('allows the handshake/profile/do_auth actions without a token', () => {
        for (const action of ['handshake', 'get_profile', 'do_auth']) {
            expect(checkRequestAuthorization(request({ action }), true)).toBe(
                null
            );
        }
    });

    it('allows any action once get_profile adopted the token', () => {
        const { token } = issueHandshakeToken(MAC);
        adoptToken(MAC, token);

        expect(checkRequestAuthorization(request({ token }), true)).toBe(null);
    });

    it('rejects a token that was never adopted by get_profile', () => {
        const { token } = issueHandshakeToken(MAC);

        expect(checkRequestAuthorization(request({ token }), true)).toBe(
            'Authorization failed.'
        );
    });

    it('refuses to adopt a token the handshake never issued', () => {
        issueHandshakeToken(MAC);

        // Stricter than the stock server on purpose: a forged or stale token
        // must not become a session, or the mock cannot catch a client whose
        // token pipeline is broken.
        expect(adoptToken(MAC, 'F0RGEDF0RGEDF0RGEDF0RGEDF0RGED12')).toBe(false);
        expect(
            checkRequestAuthorization(
                request({ token: 'F0RGEDF0RGEDF0RGEDF0RGEDF0RGED12' }),
                true
            )
        ).toBe('Authorization failed.');
    });

    it('re-adopts the already-bound token', () => {
        const { token } = issueHandshakeToken(MAC);
        adoptToken(MAC, token);

        expect(adoptToken(MAC, token)).toBe(true);
    });

    it('fails after the session is invalidated so clients must re-authenticate', () => {
        const { token } = issueHandshakeToken(MAC);
        adoptToken(MAC, token);
        invalidateSession(MAC);

        expect(checkRequestAuthorization(request({ token }), true)).toBe(
            'Authorization failed.'
        );
    });

    it('keeps pinned device identity across session invalidation', () => {
        pinDeviceIdentity(MAC, 'dev-1', undefined);
        invalidateSession(MAC);

        // Losing the token (another device logged in) never unpins device_id
        // on a real portal, so a changed identity must still conflict.
        expect(pinDeviceIdentity(MAC, 'other', undefined)).toBe(
            'device conflict - device_id mismatch'
        );
    });

    it('tracks do_auth completion per MAC', () => {
        expect(hasCompletedDoAuth(MAC)).toBe(false);

        markDoAuthCompleted(MAC);

        expect(hasCompletedDoAuth(MAC)).toBe(true);
        expect(hasCompletedDoAuth('00:1A:79:00:00:99')).toBe(false);
    });

    it('never enforces the token when enforcement is off', () => {
        expect(checkRequestAuthorization(request({}), false)).toBe(null);
    });

    it('reads the bearer token case-insensitively', () => {
        const req = {
            headers: { authorization: 'bearer  ABC123 ' },
        } as unknown as Request;

        expect(readBearerToken(req)).toBe('ABC123');
    });

    describe('device identity pinning', () => {
        it('stores the first non-empty values', () => {
            expect(pinDeviceIdentity(MAC, 'dev-1', 'dev-2')).toBe(null);
            expect(pinDeviceIdentity(MAC, 'dev-1', 'dev-2')).toBe(null);
        });

        it('reports a conflict when a pinned device_id changes', () => {
            pinDeviceIdentity(MAC, 'dev-1', undefined);

            expect(pinDeviceIdentity(MAC, 'other', undefined)).toBe(
                'device conflict - device_id mismatch'
            );
        });

        it('reports a conflict when a pinned value is later sent empty', () => {
            pinDeviceIdentity(MAC, 'dev-1', undefined);

            // This is the real lockout: a client that stops sending the id it
            // once pinned is told its STB is damaged.
            expect(pinDeviceIdentity(MAC, undefined, undefined)).toBe(
                'device conflict - device_id mismatch'
            );
        });

        it('reports the device_id2 conflict separately', () => {
            pinDeviceIdentity(MAC, undefined, 'dev-2');

            expect(pinDeviceIdentity(MAC, undefined, 'changed')).toBe(
                'device conflict - MAC address mismatch'
            );
        });

        it('accepts identity omitted entirely on a fresh MAC', () => {
            expect(pinDeviceIdentity(MAC, undefined, undefined)).toBe(null);
        });
    });
});
