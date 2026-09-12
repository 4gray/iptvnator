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
