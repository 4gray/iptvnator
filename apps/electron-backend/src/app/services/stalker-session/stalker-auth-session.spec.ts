import {
    createStalkerIdentityProfile,
    type StalkerNormalizedProfileResult,
} from '@iptvnator/portal/stalker/protocol';
import { StalkerCookieJar } from './stalker-cookie-jar';
import type { StalkerEndpointFullSessionOutcome } from './stalker-endpoint-resolver';
import {
    STALKER_HTTP_OUTCOME_KINDS,
    type StalkerHttpRequest,
    type StalkerHttpRequestOutcome,
} from './stalker-http-session';
import {
    StalkerAuthSession,
    type StalkerAuthSessionDependencies,
} from './stalker-auth-session';

const transport = {
    maxResponseBytes: 1024 * 1024,
    timeoutMs: 5000,
};

function success(
    value: unknown,
    status = 200,
    contentType = 'application/json'
): StalkerHttpRequestOutcome {
    return {
        kind: STALKER_HTTP_OUTCOME_KINDS.Success,
        result: {
            body: new TextEncoder().encode(JSON.stringify(value)),
            contentType,
            finalUrl: 'https://portal.test/server/load.php',
            status,
        },
    };
}

function resolved(
    profile: Exclude<StalkerNormalizedProfileResult, { kind: 'failure' }>
): StalkerEndpointFullSessionOutcome {
    return {
        cookieJar: new StalkerCookieJar({
            mac: '00:1A:79:AA:BB:CC',
            stb_lang: 'en',
            timezone: 'UTC',
        }),
        endpoint: 'https://portal.test/server/load.php',
        handshakeRandom: 'random-one',
        identity: createStalkerIdentityProfile({
            handshakeRandom: 'random-one',
            macAddress: '00:1A:79:AA:BB:CC',
            referer: 'https://portal.test/c/',
        }),
        kind: 'full-session',
        landingUrl: 'https://portal.test/c/',
        profile,
        profileEnvelope: { js: profile.profile },
        token: 'token-secret',
    };
}

function harness(
    profile: Exclude<StalkerNormalizedProfileResult, { kind: 'failure' }>,
    responder: (
        request: StalkerHttpRequest
    ) => StalkerHttpRequestOutcome | Promise<StalkerHttpRequestOutcome>
) {
    const calls: StalkerHttpRequest[] = [];
    const dependencies: StalkerAuthSessionDependencies = {
        createHttpSession: () => ({
            request: async (request) => {
                calls.push(request);
                return responder(request);
            },
        }),
    };
    return {
        auth: new StalkerAuthSession(
            resolved(profile),
            transport,
            dependencies
        ),
        calls,
    };
}

describe('StalkerAuthSession', () => {
    it('reuses a ready first profile without repeating handshake or profile', async () => {
        const readyProfile = {
            kind: 'ready',
            profile: {
                id: 'profile-1',
                login: 'account-one',
                watchdog_timeout: '45',
            },
            status: 0,
        } as const;
        const { auth, calls } = harness(readyProfile, () => {
            throw new Error('No request expected');
        });

        const outcome = await auth.start();

        expect(outcome).toEqual({
            accountSummary: {
                name: 'account-one',
            },
            kind: 'ready',
            watchdogIntervalSeconds: 45,
        });
        expect(auth.getPrincipalKey()).toBe('account-one');
        expect(calls).toHaveLength(0);
    });

    it('runs do_auth only after status 2, then sends the second profile with step 1', async () => {
        const { auth, calls } = harness(
            {
                kind: 'credentials-required',
                profile: { status: 2 },
                status: 2,
            },
            (request) => {
                if (request.params?.['action'] === 'do_auth') {
                    return success({ js: true });
                }
                if (request.params?.['action'] === 'get_profile') {
                    return success({
                        js: {
                            login: 'confirmed-user',
                            status: 0,
                        },
                    });
                }
                throw new Error('Unexpected request');
            }
        );

        expect(await auth.start()).toEqual({
            attemptNumber: 1,
            kind: 'credentials-required',
        });
        const outcome = await auth.submitCredentials({
            username: 'confirmed-user',
            password: 'confirmed-password',
        });

        expect(outcome).toEqual({
            accountSummary: {
                name: 'confirmed-user',
                status: '0',
            },
            kind: 'ready',
        });
        expect(auth.getPrincipalKey()).toBe('confirmed-user');
        expect(calls.map((call) => call.params?.['action'])).toEqual([
            'do_auth',
            'get_profile',
        ]);
        expect(calls[0].params).toMatchObject({
            login: 'confirmed-user',
            password: 'confirmed-password',
        });
        expect(calls[1].params?.['auth_second_step']).toBe(1);
        expect(
            (calls[0] as { headers?: Record<string, string> }).headers
                ?.Authorization
        ).toBe('Bearer token-secret');
    });

    it('marks rejected saved credentials and accepts a fresh bounded submission', async () => {
        let doAuthCount = 0;
        const { auth } = harness(
            {
                kind: 'credentials-required',
                profile: { status: 2 },
                status: 2,
            },
            (request) => {
                if (request.params?.['action'] === 'do_auth') {
                    doAuthCount += 1;
                    return success({ js: doAuthCount > 1 });
                }
                return success({ js: { login: 'fresh-user', status: 0 } });
            }
        );

        expect(
            await auth.start({
                username: 'saved-user',
                password: 'saved-password',
            })
        ).toEqual({
            attemptNumber: 2,
            kind: 'credentials-required',
            savedCredentialsRejected: true,
        });
        expect(
            await auth.submitCredentials({
                username: 'fresh-user',
                password: 'fresh-password',
            })
        ).toMatchObject({ kind: 'ready' });
        expect(auth.getPrincipalKey()).toBe('fresh-user');
    });

    it('enforces the three-submission limit without rotating token or identity', async () => {
        const { auth, calls } = harness(
            {
                kind: 'credentials-required',
                profile: { status: 2 },
                status: 2,
            },
            () => success({ js: false })
        );
        await auth.start();

        await expect(
            auth.submitCredentials({ username: 'one', password: 'bad' })
        ).resolves.toMatchObject({
            attemptNumber: 2,
            kind: 'credentials-required',
        });
        await expect(
            auth.submitCredentials({ username: 'two', password: 'bad' })
        ).resolves.toMatchObject({
            attemptNumber: 3,
            kind: 'credentials-required',
        });
        await expect(
            auth.submitCredentials({ username: 'three', password: 'bad' })
        ).resolves.toEqual({
            kind: 'failure',
            reason: 'credentials-attempt-limit',
            retryable: false,
            stage: 'do-auth',
        });
        expect(calls).toHaveLength(3);
        expect(
            calls.every(
                (call) =>
                    (call as { headers?: Record<string, string> }).headers
                        ?.Authorization === 'Bearer token-secret'
            )
        ).toBe(true);
    });

    it.each([
        {
            expected: {
                kind: 'failure',
                reason: 'rate-limited',
                retryable: true,
                stage: 'do-auth',
            },
            response: success({ error: 'slow down' }, 429),
        },
        {
            expected: {
                kind: 'failure',
                reason: 'portal-protection-blocked',
                retryable: true,
                stage: 'do-auth',
            },
            response: success(
                '<html><title>Cloudflare challenge</title></html>',
                403,
                'text/html'
            ),
        },
    ])(
        'keeps do_auth transport/protection failures distinct from bad credentials',
        async ({ response, expected }) => {
            const { auth } = harness(
                {
                    kind: 'credentials-required',
                    profile: { status: 2 },
                    status: 2,
                },
                () => response
            );
            await auth.start();

            await expect(
                auth.submitCredentials({
                    username: 'user',
                    password: 'password',
                })
            ).resolves.toEqual(expected);
        }
    );

    it('keeps token and accepted credentials in non-enumerable class state', async () => {
        const { auth } = harness(
            {
                kind: 'credentials-required',
                profile: { status: 2 },
                status: 2,
            },
            (request) =>
                request.params?.['action'] === 'do_auth'
                    ? success({ js: true })
                    : success({ js: { login: 'private-user', status: 0 } })
        );
        await auth.start();
        const outcome = await auth.submitCredentials({
            username: 'private-user',
            password: 'private-password',
        });

        expect(JSON.stringify(auth)).toBe('{}');
        expect(JSON.stringify(outcome)).not.toContain('token-secret');
        expect(JSON.stringify(outcome)).not.toContain('private-password');
    });
});
