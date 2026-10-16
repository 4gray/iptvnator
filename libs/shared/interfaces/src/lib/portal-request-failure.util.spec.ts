import { isStalkerAuthFailureMessage } from './stalker-auth-failure.util';
import {
    createPortalRequestError,
    createPortalRequestFailureEnvelope,
    formatPortalHttpErrorMessage,
    isExpectedPortalHttpStatus,
    isPortalRequestCancelledError,
    isPortalRequestFailureEnvelope,
    readPortalRequestFailure,
} from './portal-request-failure.util';
import { sourceHealthError } from './source-health';

describe('portal request failure envelope', () => {
    it('round-trips a cancellation', () => {
        const envelope = createPortalRequestFailureEnvelope({
            kind: 'cancelled',
        });

        expect(readPortalRequestFailure(envelope)).toEqual({
            kind: 'cancelled',
        });
    });

    it('round-trips an HTTP refusal with and without a status text', () => {
        expect(
            readPortalRequestFailure(
                createPortalRequestFailureEnvelope({
                    kind: 'http',
                    status: 401,
                    statusText: 'Unauthorized',
                })
            )
        ).toEqual({ kind: 'http', status: 401, statusText: 'Unauthorized' });
        expect(
            readPortalRequestFailure(
                createPortalRequestFailureEnvelope({
                    kind: 'http',
                    status: 403,
                })
            )
        ).toEqual({ kind: 'http', status: 403 });
    });

    it.each([
        ['an ordinary payload', { js: { data: [] } }],
        [
            'a payload reusing the key with another shape',
            {
                portalRequestFailure: { kind: 'http' },
            },
        ],
        ['an unknown kind', { portalRequestFailure: { kind: 'timeout' } }],
        [
            'a non-string status text',
            {
                portalRequestFailure: {
                    kind: 'http',
                    status: 401,
                    statusText: 123,
                },
            },
        ],
        [
            'a non-numeric status',
            { portalRequestFailure: { kind: 'http', status: '401' } },
        ],
        ['a string', 'Authorization failed.'],
        ['null', null],
        ['undefined', undefined],
    ])('treats %s as a normal response', (_label, value) => {
        expect(readPortalRequestFailure(value)).toBeNull();
    });

    it('narrows a bridge result to the envelope only for a valid failure', () => {
        const envelope = createPortalRequestFailureEnvelope({
            kind: 'http',
            status: 403,
        });
        const result: typeof envelope | { payload: unknown; action: string } =
            envelope;

        expect(isPortalRequestFailureEnvelope(result)).toBe(true);
        if (isPortalRequestFailureEnvelope(result)) {
            // Narrowed: the success fields are no longer on the type.
            expect(result.portalRequestFailure.kind).toBe('http');
        }
        expect(
            isPortalRequestFailureEnvelope({ payload: [], action: 'get' })
        ).toBe(false);
        expect(
            isPortalRequestFailureEnvelope({
                portalRequestFailure: { kind: 'http' },
            })
        ).toBe(false);
        // The guard vouches for every field a caller may read off the
        // original value, so a malformed status text fails it too.
        expect(
            isPortalRequestFailureEnvelope({
                portalRequestFailure: {
                    kind: 'http',
                    status: 401,
                    statusText: 123,
                },
            })
        ).toBe(false);
    });

    it('expects only the HTTP auth refusals', () => {
        expect([401, 403].every(isExpectedPortalHttpStatus)).toBe(true);
        expect(
            [200, 400, 404, 429, 500, 502, undefined, '401'].some(
                isExpectedPortalHttpStatus
            )
        ).toBe(false);
    });
});

describe('createPortalRequestError', () => {
    it('turns a cancellation into an AbortError, never an empty answer', () => {
        const error = createPortalRequestError(
            { kind: 'cancelled' },
            'stalker'
        );

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('AbortError');
        expect(error.message).toBe('Stalker request cancelled');
        expect(isPortalRequestCancelledError(error)).toBe(true);
        // The health probes read the reason from the message.
        expect(sourceHealthError(error).reason).toBe('cancelled');
        // A cancellation is not a timeout, an auth failure or an HTTP answer.
        expect(/timed out|timeout|HTTP Error/i.test(error.message)).toBe(false);
        expect(isStalkerAuthFailureMessage(error.message)).toBe(false);
    });

    it.each([
        [401, 'Unauthorized', 'HTTP Error 401: Unauthorized'],
        [403, undefined, 'HTTP Error 403'],
        [403, '  ', 'HTTP Error 403'],
    ])(
        'turns an HTTP %s refusal into the message the classifiers parse',
        (status, statusText, message) => {
            const error = createPortalRequestError(
                { kind: 'http', status, statusText },
                'xtream'
            ) as Error & { status?: number };

            expect(error.message).toBe(message);
            expect(error.status).toBe(status);
            expect(isPortalRequestCancelledError(error)).toBe(false);
            expect(sourceHealthError(error)).toMatchObject({
                reason: 'auth',
                state: 'inactive',
            });
        }
    );

    it('formats the HTTP message once for both processes', () => {
        expect(formatPortalHttpErrorMessage(401, 'Unauthorized')).toBe(
            'HTTP Error 401: Unauthorized'
        );
        expect(formatPortalHttpErrorMessage(404)).toBe('HTTP Error 404');
    });

    it('does not read a plain error as a cancellation', () => {
        expect(isPortalRequestCancelledError(new Error('canceled'))).toBe(
            false
        );
        expect(isPortalRequestCancelledError({ name: 'AbortError' })).toBe(
            false
        );
    });
});
