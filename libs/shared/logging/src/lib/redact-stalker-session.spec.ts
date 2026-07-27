import { redactSensitiveData } from './redact-sensitive-data';

function serialized(value: unknown): string {
    return JSON.stringify(value);
}

describe('Stalker session redaction', () => {
    it('redacts every main-owned session reference and authentication value', () => {
        const secrets = {
            mac: '02:00:00:00:00:01',
            serial: 'EXPLICIT-SERIAL',
            device: 'EXPLICIT-DEVICE',
            signature: 'EXPLICIT-SIGNATURE',
            challengeRef: 'opaque-challenge-secret',
            leaseRef: 'opaque-lease-secret',
            attemptRef: 'opaque-attempt-secret',
            playbackContextRef: 'opaque-playback-secret',
            sessionKey: 'internal-session-secret',
            random: 'handshake-random-secret',
            cookie: 'session=cookie-secret',
            token: 'bearer-token-secret',
        };
        const value = {
            descriptor: {
                sourceUrl: 'https://portal.example/c/',
                macAddress: secrets.mac,
                identityOverrides: {
                    serialNumber: secrets.serial,
                    deviceId1: secrets.device,
                    signature1: secrets.signature,
                },
            },
            outcome: {
                kind: 'ready',
                challengeRef: secrets.challengeRef,
                leaseRef: secrets.leaseRef,
                attemptRef: secrets.attemptRef,
                playbackContextRef: secrets.playbackContextRef,
            },
            diagnostic: {
                sessionKey: secrets.sessionKey,
                handshakeRandom: secrets.random,
                headers: {
                    Authorization: `Bearer ${secrets.token}`,
                    Cookie: secrets.cookie,
                },
            },
        };

        const output = serialized(redactSensitiveData(value));

        for (const secret of Object.values(secrets)) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('https://portal.example/c/');
        expect(output).toContain('"kind":"ready"');
    });

    it('redacts refs and identity values in query strings and diagnostic text', () => {
        const challengeRef = 'query-challenge-secret';
        const leaseRef = 'query-lease-secret';
        const random = 'query-random-secret';
        const device = 'query-device-secret';
        const url = new URL(
            `https://portal.example/api?challengeRef=${challengeRef}&lease_ref=${leaseRef}&random=${random}&device_id=${device}&action=get_profile`
        );
        const text =
            `challengeRef: ${challengeRef}; leaseRef=${leaseRef}; ` +
            `handshakeRandom: ${random}; action=get_profile`;

        const output = serialized(redactSensitiveData({ url, text }));

        expect(output).not.toContain(challengeRef);
        expect(output).not.toContain(leaseRef);
        expect(output).not.toContain(random);
        expect(output).not.toContain(device);
        expect(output).toContain('get_profile');
    });
});
