import {
    normalizeHost,
    parseSecurityPolicyError,
    SECURITY_ERROR_PREFIX,
} from './security-policy-error.utils';

describe('security-policy-error utils', () => {
    it('parses plain serialized security errors', () => {
        expect(
            parseSecurityPolicyError(
                `${SECURITY_ERROR_PREFIX}${JSON.stringify({
                    code: 'INVALID_TLS_CERTIFICATE',
                    host: 'playlist.local',
                    message: 'Certificate for this playlist host is invalid.',
                })}`
            )
        ).toEqual({
            code: 'INVALID_TLS_CERTIFICATE',
            host: 'playlist.local',
            message: 'Certificate for this playlist host is invalid.',
        });
    });

    it('parses security errors wrapped by Electron ipcRenderer.invoke', () => {
        expect(
            parseSecurityPolicyError(
                new Error(
                    `Error invoking remote method 'FETCH_PLAYLIST_BY_URL': Error: ${SECURITY_ERROR_PREFIX}${JSON.stringify(
                        {
                            code: 'INVALID_TLS_CERTIFICATE',
                            host: 'playlist.local',
                            message:
                                'Certificate for this playlist host is invalid.',
                        }
                    )}`
                )
            )
        ).toEqual({
            code: 'INVALID_TLS_CERTIFICATE',
            host: 'playlist.local',
            message: 'Certificate for this playlist host is invalid.',
        });
    });

    it('ignores malformed security payloads', () => {
        expect(
            parseSecurityPolicyError(
                `${SECURITY_ERROR_PREFIX}{"code":"INVALID_TLS_CERTIFICATE"}`
            )
        ).toBeNull();
    });

    it('normalizes host values for trust comparisons', () => {
        expect(normalizeHost(' [EXAMPLE.Local] ')).toBe('example.local');
    });
});
