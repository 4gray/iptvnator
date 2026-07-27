import { StalkerProtocolInputError } from '@iptvnator/portal/stalker/protocol';
import { UnsafeUrlError } from '../../events/url-safety';
import { StalkerRuntimeValidationError } from './stalker-runtime-validation';
import {
    STALKER_TRANSPORT_CAUSE_LIMIT,
    mapStalkerTransportError,
} from './stalker-transport-errors';

function errorWithCode(code: string, message = 'synthetic failure'): Error {
    return Object.assign(new Error(message), { code });
}

function axiosError(input: {
    code?: string;
    message?: string;
    response?: { status: number };
}): Error {
    return Object.assign(new Error(input.message ?? 'synthetic Axios failure'), {
        code: input.code,
        config: {
            headers: { authorization: 'private-bearer' },
            url: 'https://portal.example/c/?token=private-token',
        },
        isAxiosError: true,
        response: input.response,
    });
}

describe('mapStalkerTransportError', () => {
    it.each([
        ['ENOTFOUND', 'dns-failure', true],
        ['EAI_AGAIN', 'dns-failure', true],
        ['ENODATA', 'dns-failure', true],
        ['ECONNABORTED', 'request-timeout', true],
        ['ETIMEDOUT', 'request-timeout', true],
        ['UND_ERR_CONNECT_TIMEOUT', 'request-timeout', true],
        ['ECONNREFUSED', 'network-unreachable', true],
        ['ECONNRESET', 'network-unreachable', true],
        ['ENETUNREACH', 'network-unreachable', true],
        ['EHOSTUNREACH', 'network-unreachable', true],
        ['EPIPE', 'network-unreachable', true],
        ['EADDRNOTAVAIL', 'network-unreachable', true],
    ])('maps %s to %s', (code, reason, retryable) => {
        expect(mapStalkerTransportError(errorWithCode(code))).toEqual({
            reason,
            retryable,
        });
    });

    it.each([
        errorWithCode('CERT_HAS_EXPIRED'),
        errorWithCode('ERR_TLS_CERT_ALTNAME_INVALID'),
        errorWithCode('ERR_TLS_HANDSHAKE_TIMEOUT'),
        errorWithCode('ERR_SSL_PROTOCOL_ERROR'),
        new Error('self-signed certificate in certificate chain'),
    ])('maps TLS evidence without returning its raw details', (error) => {
        expect(mapStalkerTransportError(error)).toEqual({
            reason: 'tls-failure',
            retryable: false,
        });
    });

    it('maps an Axios maxContentLength failure before generic no-response handling', () => {
        expect(
            mapStalkerTransportError(
                axiosError({
                    code: 'ERR_BAD_RESPONSE',
                    message:
                        'maxContentLength size of private-limit exceeded',
                })
            )
        ).toEqual({
            reason: 'response-too-large',
            retryable: false,
        });
    });

    it('maps an Axios network error only when no HTTP response exists', () => {
        expect(
            mapStalkerTransportError(axiosError({ code: 'ERR_NETWORK' }))
        ).toEqual({
            reason: 'network-unreachable',
            retryable: true,
        });
        expect(
            mapStalkerTransportError(
                axiosError({
                    code: 'ERR_BAD_RESPONSE',
                    response: { status: 503 },
                })
            )
        ).toBeUndefined();
    });

    it.each([
        new UnsafeUrlError('Redirect loop detected', 502),
        new UnsafeUrlError('Too many redirects', 502),
    ])('maps redirect loop and ceiling failures', (error) => {
        expect(mapStalkerTransportError(error)).toEqual({
            reason: 'redirect-loop',
            retryable: false,
        });
    });

    it('maps other URL/input failures without echoing input evidence', () => {
        const secret = 'private-password';
        const errors = [
            new UnsafeUrlError(`Invalid URL ${secret}`),
            new StalkerProtocolInputError('invalid-url'),
            new StalkerRuntimeValidationError('invalid-url'),
            new StalkerRuntimeValidationError('invalid-identity-input'),
        ];

        const mapped = errors.map((error) =>
            mapStalkerTransportError(error)
        );

        expect(mapped).toEqual([
            { reason: 'invalid-url', retryable: false },
            { reason: 'invalid-url', retryable: false },
            { reason: 'invalid-url', retryable: false },
            { reason: 'invalid-identity-input', retryable: false },
        ]);
        expect(JSON.stringify(mapped)).not.toContain(secret);
    });

    it('walks a bounded cause chain and handles cycles', () => {
        expect(
            mapStalkerTransportError({
                cause: { cause: errorWithCode('ENOTFOUND') },
            })
        ).toEqual({
            reason: 'dns-failure',
            retryable: true,
        });

        let tooDeep: unknown = errorWithCode('ENOTFOUND');
        for (let index = 0; index < STALKER_TRANSPORT_CAUSE_LIMIT; index += 1) {
            tooDeep = { cause: tooDeep };
        }
        expect(mapStalkerTransportError(tooDeep)).toBeUndefined();

        const cyclic: { cause?: unknown } = {};
        cyclic.cause = cyclic;
        expect(mapStalkerTransportError(cyclic)).toBeUndefined();
    });

    it('returns only stable reason/retryable fields and never Axios secrets', () => {
        const mapped = mapStalkerTransportError(
            axiosError({
                code: 'ENOTFOUND',
                message: 'private-password private-token',
            })
        );

        expect(Object.keys(mapped ?? {}).sort()).toEqual([
            'reason',
            'retryable',
        ]);
        expect(JSON.stringify(mapped)).not.toMatch(
            /private-password|private-token|authorization|headers|config|url/i
        );
    });
});
