/**
 * Main-process wrapper behaviour: the shared singleton and what a failure
 * reported through it proves about the endpoint. The state machine itself is
 * covered in `@iptvnator/shared/host-health`.
 */

import { HostConnectivityGuardError } from '@iptvnator/shared/host-health';
import {
    beginGuardedHostRequest,
    reportGuardedHostFailure,
    resetHostConnectivityGuardForTests,
    setHostConnectivityGuardEnabled,
    reportGuardedHostSuccess,
} from './host-connectivity-guard';

describe('reportGuardedHostFailure', () => {
    const ENDPOINT = 'http://panel.example.com:8080';
    const URL_ON_ENDPOINT = `${ENDPOINT}/player_api.php`;
    let consoleWarnSpy: jest.SpyInstance;

    const hopFailure = () =>
        Object.assign(new Error('timeout of 30000ms exceeded'), {
            code: 'ETIMEDOUT',
            // A redirect hop lives on another origin and carries its own URL.
            config: { url: 'http://cdn.example.com/player_api.php' },
        });

    const ownFailure = () =>
        Object.assign(new Error('connect ECONNREFUSED'), {
            code: 'ECONNREFUSED',
            config: { url: URL_ON_ENDPOINT },
        });

    const attempt = (error: unknown): void => {
        reportGuardedHostFailure(
            beginGuardedHostRequest(URL_ON_ENDPOINT),
            error,
            // The handlers pass the URL they asked for; a failure on any other
            // URL means a redirect answered first.
            { requestUrl: URL_ON_ENDPOINT }
        );
    };

    beforeEach(() => {
        resetHostConnectivityGuardForTests();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
        resetHostConnectivityGuardForTests();
    });

    it('bypasses an open guard when disabled and starts fresh when re-enabled', () => {
        attempt(ownFailure());
        attempt(ownFailure());
        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).toThrow(
            HostConnectivityGuardError
        );
        setHostConnectivityGuardEnabled(false);
        expect(beginGuardedHostRequest(URL_ON_ENDPOINT)).toBeNull();
        setHostConnectivityGuardEnabled(true);
        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).not.toThrow();
        attempt(ownFailure());
        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).not.toThrow();
    });

    it('does not reset the guard when saving an unchanged preference', () => {
        attempt(ownFailure());
        attempt(ownFailure());
        setHostConnectivityGuardEnabled(true);
        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).toThrow(
            HostConnectivityGuardError
        );
    });

    it('ignores old failures and successes after a preference transition', () => {
        const oldFailure = beginGuardedHostRequest(URL_ON_ENDPOINT);
        const oldSuccess = beginGuardedHostRequest(URL_ON_ENDPOINT);
        setHostConnectivityGuardEnabled(false);
        setHostConnectivityGuardEnabled(true);
        reportGuardedHostFailure(oldFailure, ownFailure());
        reportGuardedHostFailure(oldFailure, ownFailure());
        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).not.toThrow();
        attempt(ownFailure());
        attempt(ownFailure());
        reportGuardedHostSuccess(oldSuccess);
        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).toThrow(
            HostConnectivityGuardError
        );
    });

    it('keeps the environment disable switch authoritative', () => {
        const original = process.env.IPTVNATOR_DISABLE_CONNECTIVITY_GUARD;
        process.env.IPTVNATOR_DISABLE_CONNECTIVITY_GUARD = '1';
        try {
            setHostConnectivityGuardEnabled(true);
            attempt(ownFailure());
            attempt(ownFailure());
            expect(() =>
                beginGuardedHostRequest(URL_ON_ENDPOINT)
            ).not.toThrow();
        } finally {
            if (original === undefined)
                delete process.env.IPTVNATOR_DISABLE_CONNECTIVITY_GUARD;
            else process.env.IPTVNATOR_DISABLE_CONNECTIVITY_GUARD = original;
        }
    });

    it('does not charge a same-origin redirect hop to the guarded endpoint', () => {
        // `/player_api.php` -> 302 -> `/slow/player_api.php` on the same origin:
        // the origin answered, so its record must clear even though the failing
        // URL shares its origin. Otherwise two such requests fast-fail every
        // other call to a portal that answers.
        const sameOriginHop = () =>
            Object.assign(new Error('timeout of 30000ms exceeded'), {
                code: 'ETIMEDOUT',
                config: { url: `${ENDPOINT}/slow/player_api.php` },
            });

        attempt(sameOriginHop());
        attempt(sameOriginHop());
        attempt(sameOriginHop());

        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).not.toThrow();
    });

    it('does not charge a redirect hop on another origin to the guarded endpoint', () => {
        // The guarded endpoint answered — it produced the redirect — so
        // charging the downstream timeout to it would eventually fast-fail a
        // working redirector.
        attempt(hopFailure());
        attempt(hopFailure());
        attempt(hopFailure());

        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).not.toThrow();
    });

    it('treats a reached redirect hop as proof the guarded endpoint answered', () => {
        // Reaching a hop on another origin means the guarded endpoint returned a
        // redirect, so its streak resets like after any other response —
        // otherwise a single later timeout becomes the second strike against an
        // endpoint that answered in between.
        attempt(ownFailure());
        attempt(hopFailure());
        attempt(ownFailure());

        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).not.toThrow();
    });

    it('still counts a failure the guarded endpoint itself produced', () => {
        attempt(ownFailure());
        attempt(ownFailure());

        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).toThrow(
            HostConnectivityGuardError
        );
    });

    it('counts a failure that names no endpoint at all', () => {
        // Not every transport error carries a config; absence must not become
        // an excuse to ignore the evidence.
        attempt(
            Object.assign(new Error('socket hang up'), { code: 'ENOTFOUND' })
        );
        attempt(
            Object.assign(new Error('socket hang up'), { code: 'ENOTFOUND' })
        );

        expect(() => beginGuardedHostRequest(URL_ON_ENDPOINT)).toThrow(
            HostConnectivityGuardError
        );
    });
});
