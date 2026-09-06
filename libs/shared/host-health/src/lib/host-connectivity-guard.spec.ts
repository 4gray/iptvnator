import {
    buildHostConnectivityFastFailMessage,
    isHostConnectivityFastFailMessage,
} from '@iptvnator/shared/interfaces';
import {
    HostConnectivityGuard,
    HostConnectivityGuardError,
    HostRequestToken,
    classifyHostRequestFailure,
    failedAfterRedirect,
    portalEndpointKeyOf,
} from './host-connectivity-guard';

const HOST = 'http://portal.example.com:8080';
const GUARD_DISABLED_ENV = 'IPTVNATOR_DISABLE_CONNECTIVITY_GUARD';
const OPEN_DURATION_MS = 30_000;
const FAILURE_WINDOW_MS = 120_000;

function timeoutError(code = 'ETIMEDOUT') {
    return Object.assign(new Error('timeout of 30000ms exceeded'), { code });
}

describe('classifyHostRequestFailure', () => {
    it('treats connection-level error codes as host-level failures', () => {
        for (const code of [
            'ECONNABORTED',
            'ECONNREFUSED',
            'EAI_AGAIN',
            'EHOSTUNREACH',
            'ENETUNREACH',
            'ENOTFOUND',
            'ETIMEDOUT',
        ]) {
            expect(classifyHostRequestFailure(timeoutError(code))).toBe(
                'host-level'
            );
        }
    });

    it('treats an error carrying an HTTP response as proof the host answered', () => {
        // 5xx reaches the handlers as a rejection: validateStatus only
        // tolerates < 500. The host still answered.
        const serverError = Object.assign(new Error('Request failed'), {
            code: 'ERR_BAD_RESPONSE',
            response: { status: 502, statusText: 'Bad Gateway' },
        });

        expect(classifyHostRequestFailure(serverError)).toBe('responded');
    });

    it('does not read reachability into cancellations, SSRF refusals or plain errors', () => {
        expect(
            classifyHostRequestFailure(
                Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
            )
        ).toBe('inconclusive');
        expect(
            classifyHostRequestFailure(
                new Error('URL host could not be resolved')
            )
        ).toBe('inconclusive');
        expect(classifyHostRequestFailure(undefined)).toBe('inconclusive');
        expect(classifyHostRequestFailure('ETIMEDOUT')).toBe('inconclusive');
    });

    it('never counts a mid-transfer connection reset', () => {
        // A reset happens on hosts that are very much alive.
        expect(classifyHostRequestFailure(timeoutError('ECONNRESET'))).toBe(
            'inconclusive'
        );
    });
});

describe('failedAfterRedirect', () => {
    // Two transports put the failed hop in two different places, and reading
    // only one of them silently mis-attributes on the other.
    const ENDPOINT = 'http://panel.example:8080';
    const ASKED_FOR = `${ENDPOINT}/player_api.php`;
    const token: HostRequestToken = {
        endpoint: ENDPOINT,
        epoch: 0,
        admissionId: 0,
        trial: false,
        trialId: 0,
    };

    it('reads the hop from request._currentUrl when redirects were followed internally', () => {
        // axios' default (follow-redirects) transport: `config` is built once
        // and keeps the URL we asked for, whatever the chain did afterwards.
        const error = {
            code: 'ECONNREFUSED',
            config: { url: ASKED_FOR },
            request: { _currentUrl: 'http://cdn.dead.example/stream' },
        };

        expect(failedAfterRedirect(error, token, ASKED_FOR)).toBe(true);
    });

    it('falls back to config.url for a transport that reissues each hop', () => {
        // The Electron transport uses `maxRedirects: 0` and follows redirects
        // itself, so there is no `_currentUrl` and the hop is the config URL.
        const error = {
            code: 'ECONNREFUSED',
            config: { url: 'http://cdn.dead.example/stream' },
        };

        expect(failedAfterRedirect(error, token, ASKED_FOR)).toBe(true);
    });

    it('reports no redirect when the request failed against the URL we asked for', () => {
        const error = {
            code: 'ECONNREFUSED',
            config: { url: ASKED_FOR },
            request: { _currentUrl: ASKED_FOR },
        };

        expect(failedAfterRedirect(error, token, ASKED_FOR)).toBe(false);
    });
});

describe('portalEndpointKeyOf', () => {
    it('keys on host and port so two panels on one machine stay separate', () => {
        expect(
            portalEndpointKeyOf('http://example.com:8080/player_api.php')
        ).toBe('http://example.com:8080');
        expect(
            portalEndpointKeyOf('http://example.com:9090/player_api.php')
        ).toBe('http://example.com:9090');
    });

    it('separates HTTP from HTTPS on their default ports', () => {
        // `URL.host` omits a default port, so both would collapse onto
        // `example.com` — and a panel whose TLS listener is broken while plain
        // HTTP works is a routine IPTV setup.
        expect(portalEndpointKeyOf('http://example.com/player_api.php')).toBe(
            'http://example.com'
        );
        expect(portalEndpointKeyOf('https://example.com/player_api.php')).toBe(
            'https://example.com'
        );
    });

    it('leaves URL credentials out of the key', () => {
        expect(portalEndpointKeyOf('http://user:pass@example.com/c')).toBe(
            'http://example.com'
        );
    });

    it('returns null for an unparseable URL instead of throwing', () => {
        expect(portalEndpointKeyOf('not a url')).toBeNull();
    });
});

describe('HostConnectivityGuardError', () => {
    it('carries the shared fast-fail message and no status field', () => {
        const error = new HostConnectivityGuardError(HOST);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(buildHostConnectivityFastFailMessage(HOST));
        // getStalkerRequestErrorStatus reads `status` first; a number there
        // would read as "the endpoint answered".
        expect(
            (error as unknown as { status?: unknown }).status
        ).toBeUndefined();
        expect(isHostConnectivityFastFailMessage(error.message)).toBe(true);
    });
});

describe('HostConnectivityGuard', () => {
    let clock = 1_000_000;
    let opened: string[];
    let guard: HostConnectivityGuard;

    const advance = (ms: number) => {
        clock += ms;
    };

    /** Runs a request that fails at the host level after `durationMs`. */
    const failRequest = (durationMs = 0): void => {
        const check = guard.check(HOST);
        if (!check.allowed) {
            throw new Error('expected the request to be allowed');
        }
        advance(durationMs);
        guard.reportFailure(check.token);
    };

    const expectAllowed = (): HostRequestToken => {
        const check = guard.check(HOST);
        expect(check.allowed).toBe(true);
        if (!check.allowed) {
            throw new Error('unreachable');
        }
        return check.token;
    };

    const expectBlocked = (): void => {
        expect(guard.check(HOST).allowed).toBe(false);
    };

    beforeEach(() => {
        clock = 1_000_000;
        opened = [];
        delete process.env[GUARD_DISABLED_ENV];
        guard = new HostConnectivityGuard({
            now: () => clock,
            onOpen: (host) => opened.push(host),
        });
    });

    it('allows requests to a host it has never seen', () => {
        expect(guard.check(HOST).allowed).toBe(true);
        expect(opened).toEqual([]);
    });

    it('still allows the request after a single failure', () => {
        failRequest(30_000);

        expect(guard.check(HOST).allowed).toBe(true);
        expect(opened).toEqual([]);
    });

    it('opens after two consecutive failures and reports the wait', () => {
        failRequest(30_000);
        failRequest(30_000);

        expect(guard.check(HOST)).toEqual({
            allowed: false,
            retryAfterMs: OPEN_DURATION_MS,
        });
        expect(opened).toEqual([HOST]);
    });

    it('logs the open transition once, not per blocked request', () => {
        failRequest(30_000);
        failRequest(30_000);
        expectBlocked();
        expectBlocked();

        expect(opened).toEqual([HOST]);
    });

    it('keeps other hosts untouched', () => {
        failRequest(30_000);
        failRequest(30_000);

        expect(guard.check('http://other.example.com').allowed).toBe(true);
    });

    it('keeps the same host on another scheme reachable', () => {
        // Regression: keying by `URL.host` dropped the default port, so a dead
        // HTTPS panel fast-failed the working HTTP one on the same machine.
        failRequest(30_000);
        failRequest(30_000);
        expectBlocked();

        expect(guard.check('https://portal.example.com:8080').allowed).toBe(
            true
        );
    });

    it('counts a parallel fan-out that fails together as one failure', () => {
        // Catalog init loads live/vod/series at once. One wifi hiccup failing
        // all three is one piece of evidence, not a trip.
        const first = expectAllowed();
        const second = expectAllowed();
        const third = expectAllowed();

        advance(30_000);
        guard.reportFailure(first);
        guard.reportFailure(second);
        guard.reportFailure(third);

        expect(guard.check(HOST).allowed).toBe(true);
        expect(opened).toEqual([]);
    });

    it.each([
        [0, 1, 2],
        [2, 0, 1],
        [1, 2, 0],
    ])(
        'counts same-millisecond siblings once in completion order %s, %s, %s',
        (...order) => {
            const tokens = [expectAllowed(), expectAllowed(), expectAllowed()];

            for (const index of order) {
                guard.reportFailure(tokens[index]);
            }

            expectAllowed();
            expect(opened).toEqual([]);
        }
    );

    it('keeps old siblings together after their endpoint state is evicted', () => {
        const first = expectAllowed();
        const sibling = expectAllowed();
        for (let index = 0; index < 256; index += 1) {
            guard.check(`http://other-${index}.example`);
        }
        expectAllowed();
        advance(30_000);

        guard.reportFailure(first);
        guard.reportFailure(sibling);

        expectAllowed();
        expect(opened).toEqual([]);
    });

    it('counts a new attempt after a failure even in the same millisecond', () => {
        failRequest();
        failRequest();

        expectBlocked();
        expect(opened).toEqual([HOST]);
    });

    it('does not extend the cooldown for same-millisecond siblings', () => {
        const first = expectAllowed();
        const sibling = expectAllowed();
        guard.reportFailure(first);
        failRequest();
        expectBlocked();

        advance(OPEN_DURATION_MS);
        guard.reportFailure(sibling);

        expect(expectAllowed().trial).toBe(true);
        expect(opened).toEqual([HOST]);
    });

    it('opens when a second fan-out fails after the first one did', () => {
        const first = expectAllowed();
        const second = expectAllowed();
        advance(30_000);
        guard.reportFailure(first);
        guard.reportFailure(second);

        failRequest(30_000);

        expectBlocked();
        expect(opened).toEqual([HOST]);
    });

    it('does not re-open on a sibling that settles after the window elapsed', () => {
        // A and B start together; A plus a later request open the breaker. B is
        // explicitly not counted as a strike, so it must not start a fresh
        // 30-second window either — that would push the half-open trial past
        // the intended cooldown.
        const sibling = expectAllowed();
        const first = expectAllowed();
        advance(30_000);
        guard.reportFailure(first);
        failRequest(30_000);
        expectBlocked();
        expect(opened).toEqual([HOST]);

        advance(OPEN_DURATION_MS);
        guard.reportFailure(sibling);

        const trial = expectAllowed();
        expect(trial.trial).toBe(true);
        expect(opened).toEqual([HOST]);
    });

    it('does not accumulate failures further apart than the streak window', () => {
        failRequest(0);
        advance(FAILURE_WINDOW_MS + 1);
        failRequest(0);

        expect(guard.check(HOST).allowed).toBe(true);
        expect(opened).toEqual([]);
    });

    it('accumulates failures exactly at the streak window edge', () => {
        failRequest(0);
        advance(FAILURE_WINDOW_MS);
        failRequest(0);

        expectBlocked();
    });

    it('clears the record as soon as the host answers', () => {
        failRequest(30_000);
        const token = expectAllowed();
        guard.reportSuccess(token);
        failRequest(30_000);

        expect(guard.check(HOST).allowed).toBe(true);
        expect(opened).toEqual([]);
    });

    it('treats a success followed by an inconclusive report as a no-op', () => {
        // The Stalker handler reports success on the response, then throws its
        // own `HTTP Error 404` error, which is classified inconclusive.
        failRequest(30_000);
        const token = expectAllowed();
        guard.reportSuccess(token);
        guard.reportInconclusive(token);
        failRequest(30_000);

        expect(guard.check(HOST).allowed).toBe(true);
    });

    it('ignores an inconclusive failure entirely', () => {
        const first = expectAllowed();
        guard.reportInconclusive(first);
        const second = expectAllowed();
        guard.reportInconclusive(second);

        expect(guard.check(HOST).allowed).toBe(true);
        expect(opened).toEqual([]);
    });

    describe('half-open', () => {
        beforeEach(() => {
            failRequest(30_000);
            failRequest(30_000);
            expectBlocked();
            advance(OPEN_DURATION_MS);
        });

        it('lets exactly one request through once the window elapses', () => {
            const trial = expectAllowed();
            expect(trial.trial).toBe(true);

            expect(guard.check(HOST).allowed).toBe(false);
            expect(guard.check(HOST).allowed).toBe(false);
        });

        it('keeps a live trial exclusive beyond 45 seconds and the idle TTL', () => {
            const trial = expectAllowed();
            advance(45_001);
            expectBlocked();
            advance(600_001);
            guard.check('http://another.example');
            expectBlocked();
            guard.reportSuccess(trial);
            expect(expectAllowed().trial).toBe(false);
        });

        it.each([
            'reportSuccess',
            'reportFailure',
            'reportInconclusive',
        ] as const)(
            'releases a completed trial via %s while the environment override is disabled',
            (report) => {
                const trial = expectAllowed();
                process.env[GUARD_DISABLED_ENV] = '1';
                guard[report](trial);
                delete process.env[GUARD_DISABLED_ENV];
                expect(expectAllowed().trial).toBe(true);
            }
        );

        it('closes the breaker when the trial succeeds', () => {
            const trial = expectAllowed();
            guard.reportSuccess(trial);

            const next = expectAllowed();
            expect(next.trial).toBe(false);
            expect(guard.check(HOST).allowed).toBe(true);
        });

        it('re-opens immediately when the trial fails, without a second strike', () => {
            const trial = expectAllowed();
            advance(30_000);
            guard.reportFailure(trial);

            expect(guard.check(HOST)).toEqual({
                allowed: false,
                retryAfterMs: OPEN_DURATION_MS,
            });
            expect(opened).toEqual([HOST, HOST]);
        });

        it('offers the trial slot again when the trial is cancelled', () => {
            const trial = expectAllowed();
            guard.reportInconclusive(trial);

            const retry = expectAllowed();
            expect(retry.trial).toBe(true);
        });

        it('lets only the request holding the slot release it', () => {
            // Cleanup may run again after a replacement has acquired the slot.
            const abandoned = expectAllowed();
            guard.reportInconclusive(abandoned);
            const replacement = expectAllowed();
            expect(replacement.trial).toBe(true);

            guard.reportInconclusive(abandoned);

            expectBlocked();
        });

        it('keeps the replacement slot when the old owner reports a late failure', () => {
            const old = expectAllowed();
            guard.reportInconclusive(old);
            const replacement = expectAllowed();
            guard.reportFailure(old);
            advance(OPEN_DURATION_MS + 1);
            expectBlocked();
            guard.reportInconclusive(old);
            expectBlocked();
            guard.reportSuccess(replacement);
            expect(expectAllowed().trial).toBe(false);
        });

        it('recovers when the owner releases a trial without an outcome report', () => {
            const trial = expectAllowed();
            expectBlocked();
            // The request owner's finally is independent of outcome reporting.
            guard.reportInconclusive(trial);

            const replacement = expectAllowed();
            expect(replacement.trial).toBe(true);
        });
    });

    describe('reset', () => {
        it('reopens the host for requests immediately', () => {
            failRequest(30_000);
            failRequest(30_000);
            expectBlocked();

            guard.reset(HOST);

            expect(expectAllowed().trial).toBe(false);
        });

        it('discards failures from requests that started before it', () => {
            // The retry that cleared the breaker must not be poisoned by the
            // 30-second stragglers it was waiting behind.
            const straggler = expectAllowed();
            const secondStraggler = expectAllowed();
            advance(15_000);
            guard.reset(HOST);

            advance(15_000);
            guard.reportFailure(straggler);
            guard.reportFailure(secondStraggler);

            expect(guard.check(HOST).allowed).toBe(true);
            expect(opened).toEqual([]);
        });

        it('still counts failures from requests started after it', () => {
            failRequest(30_000);
            guard.reset(HOST);
            failRequest(30_000);
            failRequest(30_000);

            expectBlocked();
        });

        it('supersedes in-flight requests for a host it has no record of', () => {
            const token = expectAllowed();
            guard.clear();
            guard.reset(HOST);
            advance(30_000);
            guard.reportFailure(token);
            failRequest(30_000);

            expect(guard.check(HOST).allowed).toBe(true);
        });
    });

    describe('bookkeeping bounds', () => {
        it('forgets idle records instead of growing without bound', () => {
            for (let index = 0; index < 300; index += 1) {
                advance(1);
                guard.check(`http://host-${index}.example.com`);
            }

            // The cap held, and a fresh host is still allowed through.
            expect(guard.check(HOST).allowed).toBe(true);
        });

        it('keeps an open breaker while other hosts churn past the idle TTL', () => {
            failRequest(30_000);
            failRequest(30_000);
            expectBlocked();

            advance(1);
            guard.check('http://noise.example.com');

            expectBlocked();
        });
    });

    describe('kill switch', () => {
        afterEach(() => {
            delete process.env[GUARD_DISABLED_ENV];
        });

        it('never blocks a request while disabled', () => {
            process.env[GUARD_DISABLED_ENV] = '1';

            failRequest(30_000);
            failRequest(30_000);
            failRequest(30_000);

            expect(guard.check(HOST).allowed).toBe(true);
            expect(opened).toEqual([]);
        });

        it('accepts the "true" spelling', () => {
            process.env[GUARD_DISABLED_ENV] = 'true';

            failRequest(30_000);
            failRequest(30_000);

            expect(guard.check(HOST).allowed).toBe(true);
        });

        it('is read per call, so an already open breaker stops blocking', () => {
            failRequest(30_000);
            failRequest(30_000);
            expectBlocked();

            process.env[GUARD_DISABLED_ENV] = '1';

            expect(guard.check(HOST).allowed).toBe(true);
        });
    });
});
