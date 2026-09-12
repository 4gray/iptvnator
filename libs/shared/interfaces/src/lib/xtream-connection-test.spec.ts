import {
    describeXtreamConnectionFailure,
    xtreamHttpAlternative,
} from './xtream-connection-test';

describe('Xtream connection transport evidence', () => {
    it.each([
        [
            'https://panel.test/get.php?username=x&password=y',
            'http://panel.test',
        ],
        [
            'https://panel.test:443/base/player_api.php',
            'http://panel.test/base',
        ],
        ['https://panel.test:8443/base/', 'http://panel.test:8443/base'],
        ['http://panel.test', null],
    ])('builds only the same-host alternative for %s', (input, expected) => {
        expect(xtreamHttpAlternative(input)).toBe(expected);
    });

    it.each(['ECONNREFUSED', 'ERR_SSL_WRONG_VERSION_NUMBER'])(
        'accepts initial %s but excludes redirect failures',
        (code) => {
            expect(
                describeXtreamConnectionFailure({ code }, false).canTryHttp
            ).toBe(true);
            expect(
                describeXtreamConnectionFailure({ code }, true).canTryHttp
            ).toBe(false);
        }
    );

    it.each([
        'ssl3_get_record:wrong version number',
        'OPENSSL_internal:WRONG_VERSION_NUMBER',
    ])('recognizes a plaintext HTTP listener: %s', (message) => {
        expect(
            describeXtreamConnectionFailure(
                {
                    code: 'EPROTO',
                    message,
                },
                false
            ).canTryHttp
        ).toBe(true);
    });

    it.each([
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ERR_CANCELED',
        'CERT_HAS_EXPIRED',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'EPROTO',
    ])('never authorizes HTTP for %s', (code) => {
        expect(
            describeXtreamConnectionFailure({ code }, false).canTryHttp
        ).toBe(false);
    });

    it.each([
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'INVALID_CA',
        'HOSTNAME_MISMATCH',
        'PATH_LENGTH_EXCEEDED',
        'INVALID_PURPOSE',
        'UNABLE_TO_GET_CRL',
    ])(
        'recognizes certificate verification failure %s without allowing HTTP',
        (code) => {
            expect(describeXtreamConnectionFailure({ code }, false)).toEqual({
                kind: 'tls',
                canTryHttp: false,
            });
        }
    );

    it.each([undefined, 'ECONNREFUSED'])(
        'requires all address failures to be positive (aggregate code=%s)',
        (code) => {
            const refused = { code: 'ECONNREFUSED' };
            const aggregate = (other: unknown) => ({
                code,
                errors: [refused, other],
            });
            expect(
                describeXtreamConnectionFailure(aggregate(refused), false)
                    .canTryHttp
            ).toBe(true);
            for (const other of [
                { code: 'ETIMEDOUT' },
                { code: 'ENOTFOUND' },
                {},
                null,
            ]) {
                expect(
                    describeXtreamConnectionFailure(aggregate(other), false)
                        .canTryHttp
                ).toBe(false);
            }
            expect(
                describeXtreamConnectionFailure(aggregate(refused), true)
                    .canTryHttp
            ).toBe(false);
        }
    );

    it('traverses wrappers and shared aggregate causes without losing TLS or HTTP evidence', () => {
        const errors = [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }];
        const aggregate = { errors };
        expect(
            describeXtreamConnectionFailure({ errors, cause: aggregate }, false)
                .canTryHttp
        ).toBe(true);
        expect(
            describeXtreamConnectionFailure(
                {
                    code: 'ECONNREFUSED',
                    cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
                },
                false
            )
        ).toEqual({ kind: 'tls', canTryHttp: false });
        expect(
            describeXtreamConnectionFailure(
                { cause: { response: { status: 403 }, cause: aggregate } },
                false
            )
        ).toEqual({ kind: 'http', status: 403, canTryHttp: false });
    });

    it('fails closed for empty aggregates, cycles and oversized cause trees', () => {
        expect(
            describeXtreamConnectionFailure(
                { code: 'ECONNREFUSED', errors: [] },
                false
            ).canTryHttp
        ).toBe(false);
        const cycle: { code: string; cause?: unknown } = {
            code: 'ECONNREFUSED',
        };
        cycle.cause = cycle;
        expect(describeXtreamConnectionFailure(cycle, false).canTryHttp).toBe(
            false
        );
        let deep: unknown = { code: 'ECONNREFUSED' };
        for (let index = 0; index < 100; index++) deep = { cause: deep };
        expect(describeXtreamConnectionFailure(deep, false).canTryHttp).toBe(
            false
        );
        expect(
            describeXtreamConnectionFailure(
                {
                    errors: Array.from({ length: 100 }, () => ({
                        code: 'ECONNREFUSED',
                    })),
                },
                false
            ).canTryHttp
        ).toBe(false);
    });

    it('keeps HTTP status without provider text or credentials', () => {
        expect(
            describeXtreamConnectionFailure(
                {
                    response: { status: 403 },
                    message: 'secret',
                    code: 'ECONNREFUSED',
                },
                false
            )
        ).toEqual({ kind: 'http', status: 403, canTryHttp: false });
    });
});
