import {
    stalkerIdentityFingerprint,
    stalkerSessionFingerprint,
} from './stalker-session-fingerprint.util';

describe('shared Stalker session fingerprints', () => {
    const connection = {
        portalUrl: 'https://portal.test/c/',
        macAddress: '00:1A:79:00:00:01',
        username: 'user',
        password: 'secret',
    };

    it('retains the persisted fingerprint format and trim normalization', () => {
        expect(stalkerSessionFingerprint(connection)).toBe(
            '["https://portal.test/c","[\\"00:1A:79:00:00:01\\",\\"\\",\\"\\",\\"\\",\\"\\",\\"\\"]","user","secret"]'
        );
        expect(stalkerIdentityFingerprint({ macAddress: '  mac  ' })).toBe(
            stalkerIdentityFingerprint({
                macAddress: 'mac',
                stalkerSerialNumber: '',
            })
        );
    });

    it.each([
        'portalUrl',
        'macAddress',
        'username',
        'password',
        'stalkerSerialNumber',
        'stalkerDeviceId1',
        'stalkerDeviceId2',
        'stalkerSignature1',
        'stalkerSignature2',
    ] as const)('binds the token to %s', (field) => {
        expect(
            stalkerSessionFingerprint({ ...connection, [field]: 'changed' })
        ).not.toBe(stalkerSessionFingerprint(connection));
    });

    it('distinguishes Basic-auth endpoint identities without changing ordinary endpoints', () => {
        expect(
            stalkerSessionFingerprint({
                ...connection,
                portalUrl: 'https://one:pw@portal.test/c',
            })
        ).not.toBe(
            stalkerSessionFingerprint({
                ...connection,
                portalUrl: 'https://two:pw@portal.test/c',
            })
        );
        expect(stalkerSessionFingerprint({})).not.toBe(
            stalkerSessionFingerprint({ portalUrl: 'malformed endpoint' })
        );
    });
});
