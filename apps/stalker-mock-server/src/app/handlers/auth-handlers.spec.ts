import { Request, Response } from 'express';
import {
    checkRequestAuthorization,
    resetAuthState,
} from '../auth-store';
import { handleDoAuth } from './do-auth.handler';
import { handleGetEvents } from './get-events.handler';
import { handleGetProfile } from './get-profile.handler';
import { handleHandshake } from './handshake.handler';

/**
 * Handler-level coverage for the authentication actions.
 *
 * The e2e suite drives the app through this flow end to end; these handler
 * tests pin the SERVER half of the contract independently, so a client-side
 * regression and a mock-side one cannot mask each other.
 *
 * Handlers are called directly instead of through the dispatcher: the
 * dispatcher pulls in every content handler and therefore the faker-based
 * data generator, which this project's Jest setup does not transform.
 */

const LOGIN_REQUIRED_MAC = '00:1A:79:00:00:08';
const PLAIN_MAC = '00:1A:79:00:00:01';
const BAD_FORMAT_MAC = 'AA:BB:CC:DD:EE:01';

type Handler = (
    req: Request,
    res: Response,
    options?: { enforceMacFormat?: boolean }
) => void;

function invoke(
    handler: Handler,
    query: Record<string, string>,
    options: {
        mac?: string;
        token?: string;
        enforceMacFormat?: boolean;
    } = {}
): Record<string, unknown> {
    const headers: Record<string, string> = {
        cookie: `mac=${options.mac ?? PLAIN_MAC}`,
    };
    if (options.token) {
        headers['authorization'] = `Bearer ${options.token}`;
    }

    let body: unknown;
    const req = { query, headers, params: {} } as unknown as Request;
    const res = {
        json: (data: unknown) => {
            body = data;
        },
    } as unknown as Response;

    handler(req, res, { enforceMacFormat: options.enforceMacFormat ?? true });

    return (body as { js: Record<string, unknown> }).js;
}

function contentRequest(mac: string, token?: string): Request {
    const headers: Record<string, string> = { cookie: `mac=${mac}` };
    if (token) {
        headers['authorization'] = `Bearer ${token}`;
    }
    return {
        headers,
        query: { action: 'get_categories' },
    } as unknown as Request;
}

describe('stalker mock authentication handlers', () => {
    beforeEach(() => {
        resetAuthState();
    });

    it('walks the login-required scenario: status 2 -> do_auth -> profile', () => {
        const token = invoke(handleHandshake, { action: 'handshake' }, {
            mac: LOGIN_REQUIRED_MAC,
        })['token'] as string;
        expect(token).toMatch(/^[0-9A-F]{32}$/);

        // A client could mislabel its first profile as the second auth step;
        // that parameter alone must not satisfy the scenario.
        expect(
            invoke(
                handleGetProfile,
                { action: 'get_profile', auth_second_step: '1' },
                { mac: LOGIN_REQUIRED_MAC, token }
            )['status']
        ).toBe(2);

        // Empty credentials are refused, as the operator billing script would.
        expect(
            invoke(
                handleDoAuth,
                { action: 'do_auth', login: '', password: '' },
                { mac: LOGIN_REQUIRED_MAC }
            ) as unknown
        ).toBe(false);

        expect(
            invoke(
                handleDoAuth,
                { action: 'do_auth', login: 'user', password: 'secret' },
                { mac: LOGIN_REQUIRED_MAC }
            ) as unknown
        ).toBe(true);

        const profile = invoke(
            handleGetProfile,
            { action: 'get_profile' },
            { mac: LOGIN_REQUIRED_MAC, token }
        );
        expect(profile['status']).toBe(0);
        expect(profile['watchdog_timeout']).toBe(120);

        // Only now is the token adopted, so protected actions are authorized.
        expect(
            checkRequestAuthorization(
                contentRequest(LOGIN_REQUIRED_MAC, token),
                true
            )
        ).toBe(null);
    });

    it('rejects a non-Infomir MAC and never adopts its token', () => {
        const token = invoke(handleHandshake, { action: 'handshake' }, {
            mac: BAD_FORMAT_MAC,
        })['token'] as string;

        expect(
            invoke(
                handleGetProfile,
                { action: 'get_profile' },
                { mac: BAD_FORMAT_MAC, token }
            )
        ).toEqual({ status: 1 });

        expect(
            checkRequestAuthorization(contentRequest(BAD_FORMAT_MAC, token), true)
        ).toBe('Authorization failed.');
    });

    it('accepts that MAC on the tolerant endpoint, which skips format checks', () => {
        const token = invoke(handleHandshake, { action: 'handshake' }, {
            mac: BAD_FORMAT_MAC,
        })['token'] as string;

        expect(
            invoke(
                handleGetProfile,
                { action: 'get_profile' },
                { mac: BAD_FORMAT_MAC, token, enforceMacFormat: false }
            )['status']
        ).toBe(0);
    });

    it('reports a device conflict once an id was pinned', () => {
        const token = invoke(handleHandshake, { action: 'handshake' })[
            'token'
        ] as string;
        invoke(
            handleGetProfile,
            { action: 'get_profile', device_id: 'dev-A' },
            { token }
        );

        const conflict = invoke(
            handleGetProfile,
            { action: 'get_profile', device_id: 'dev-B' },
            { token }
        );
        expect(conflict['msg']).toBe('device conflict - device_id mismatch');
        expect(conflict['block_msg']).toContain('Your STB is damaged');
    });

    it('returns the handshake nonce and re-confirms an adopted token', () => {
        const first = invoke(handleHandshake, { action: 'handshake' });
        const token = first['token'] as string;
        expect(first['random']).toEqual(expect.any(String));
        expect(first['not_valid']).toBe(0);

        invoke(handleGetProfile, { action: 'get_profile' }, { token });

        // Presenting the adopted token returns it unchanged — this is what lets
        // real clients persist a token across restarts.
        const second = invoke(handleHandshake, {
            action: 'handshake',
            token,
        });
        expect(second['token']).toBe(token);
        expect(second['not_valid']).toBe(0);
    });

    it('answers the watchdog with an empty event set', () => {
        expect(
            invoke(handleGetEvents, {
                action: 'get_events',
                type: 'watchdog',
                init: '1',
            })
        ).toEqual({ data: { msgs: 0, additional_services_on: '1' } });
    });
});
