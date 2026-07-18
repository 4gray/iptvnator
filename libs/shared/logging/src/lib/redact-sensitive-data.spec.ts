import { REDACTED_VALUE, redactSensitiveData } from './redact-sensitive-data';

const TEST_SECRETS = [
    'settings-api-key-secret',
    'nested-user-secret',
    'nested-password-secret',
    'nested-token-secret',
    'nested-auth-secret',
    'nested-mac-secret',
    'query-password-secret',
    'query-token-secret',
];

function serialized(value: unknown): string {
    return JSON.stringify(value);
}

describe('redactSensitiveData', () => {
    it('recursively redacts credentials while retaining diagnostic fields', () => {
        const input = {
            operation: 'get_profile',
            settings: { tmdb: { apiKey: TEST_SECRETS[0] } },
            params: {
                username: TEST_SECRETS[1],
                PASSWORD: TEST_SECRETS[2],
                access_token: TEST_SECRETS[3],
                headers: { Authorization: `Bearer ${TEST_SECRETS[4]}` },
                macAddress: TEST_SECRETS[5],
            },
        };

        const result = redactSensitiveData(input);
        const output = serialized(result);

        for (const secret of TEST_SECRETS) {
            expect(output).not.toContain(secret);
        }
        expect(result).toEqual({
            operation: 'get_profile',
            settings: { tmdb: { apiKey: REDACTED_VALUE } },
            params: {
                username: REDACTED_VALUE,
                PASSWORD: REDACTED_VALUE,
                access_token: REDACTED_VALUE,
                headers: { Authorization: REDACTED_VALUE },
                macAddress: REDACTED_VALUE,
            },
        });
    });

    it('redacts Stalker identity credentials while retaining request diagnostics', () => {
        const identitySecrets = {
            sn: 'stalker-sn-secret',
            device_id: 'stalker-device-id-secret',
            device_id2: 'stalker-device-id2-secret',
            signature: 'stalker-signature-secret',
            signature2: 'stalker-signature2-secret',
        };

        const result = redactSensitiveData({
            action: 'get_profile',
            requestId: 'stalker-request-id',
            params: identitySecrets,
        });
        const output = serialized(result);

        for (const secret of Object.values(identitySecrets)) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('get_profile');
        expect(output).toContain('stalker-request-id');
    });

    it('redacts credentials embedded in URL, URLSearchParams, errors, and serialized strings', () => {
        const url = new URL(
            `https://user:pass@example.com/live?password=${TEST_SECRETS[6]}&token=${TEST_SECRETS[7]}&action=get_live_streams`
        );
        const params = new URLSearchParams({
            authorization: TEST_SECRETS[4],
            category: 'news',
        });
        const error = new Error(
            `Request failed: https://example.com/api?token=${TEST_SECRETS[3]}&action=profile`
        );
        const json = JSON.stringify({
            refreshToken: TEST_SECRETS[3],
            status: 401,
        });

        const output = serialized(
            redactSensitiveData({ url, params, error, json })
        );

        for (const secret of TEST_SECRETS) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('action=get_live_streams');
        expect(output).toContain('category=news');
        expect(output).toContain('status');
        expect(output).toContain('401');
    });

    it('redacts a credential from a single-parameter string', () => {
        const password = 'single-param-password-secret';
        const token = 'single-param-token-secret';

        const output = serialized(
            redactSensitiveData([
                `password=${password}`,
                `token=${token}`,
                'operation=get_profile',
            ])
        );

        expect(output).not.toContain(password);
        expect(output).not.toContain(token);
        expect(output).toContain('get_profile');
    });

    it('does not repeat a redacted Error message secret in its stack', () => {
        const secret = 'error-stack-password-secret';
        const error = new Error(`password=${secret}&operation=get_profile`);

        const output = serialized(redactSensitiveData(error));

        expect(output).not.toContain(secret);
        expect(output).toContain(encodeURIComponent(REDACTED_VALUE));
        expect(output).toContain('get_profile');
    });

    it('redacts credentials nested inside non-sensitive query values', () => {
        const nestedUrl = `https://identity.example/callback?token=${TEST_SECRETS[3]}&step=authorize`;
        const url = new URL('https://example.com/portal');
        url.searchParams.set('redirect', nestedUrl);
        url.searchParams.set(
            'payload',
            JSON.stringify({ password: TEST_SECRETS[2], action: 'profile' })
        );

        const output = serialized(redactSensitiveData(url));

        expect(output).not.toContain(TEST_SECRETS[2]);
        expect(output).not.toContain(TEST_SECRETS[3]);
        expect(output).toContain('authorize');
        expect(output).toContain('profile');
    });

    it('redacts Xtream credentials in playback URL paths', () => {
        const username = 'xtream-path-user-secret';
        const password = 'xtream-path-password-secret';
        const urls = [
            new URL(
                `https://example.com/base/live/${username}/${password}/101.ts`
            ),
            new URL(
                `https://example.com/movie/${username}/${password}/202.mkv`
            ),
            new URL(
                `https://example.com/series/${username}/${password}/303.mp4`
            ),
            new URL(
                `https://example.com/timeshift/${username}/${password}/60/2026-07-18:12-00/404.ts`
            ),
        ];
        const embedded = `Playback failed for https://example.com/live/${username}/${password}/505.m3u8`;
        const ordinaryLiveUrl = 'https://example.com/live/channel.m3u8';

        const output = serialized(
            redactSensitiveData({ urls, embedded, ordinaryLiveUrl })
        );

        expect(output).not.toContain(username);
        expect(output).not.toContain(password);
        expect(output).toContain('101.ts');
        expect(output).toContain('202.mkv');
        expect(output).toContain('303.mp4');
        expect(output).toContain('404.ts');
        expect(output).toContain('505.m3u8');
        expect(output).toContain(ordinaryLiveUrl);
    });

    it('redacts Xtream path credentials when no resource segment follows', () => {
        const username = 'terminal-xtream-user-secret';
        const password = 'terminal-xtream-password-secret';

        const output = serialized(
            redactSensitiveData(
                new URL(`https://example.com/live/${username}/${password}`)
            )
        );

        expect(output).not.toContain(username);
        expect(output).not.toContain(password);
    });

    it('does not mutate input and safely bounds cycles, depth, arrays, objects, and strings', () => {
        const input: Record<string, unknown> = {
            status: 'ok',
            password: TEST_SECRETS[2],
            items: [1, 2, 3, 4],
            long: 'abcdefghij',
            nested: { level: { value: 'too deep' } },
            extraA: 'a',
            extraB: 'b',
        };
        input['self'] = input;
        const originalItems = input['items'];

        const result = redactSensitiveData(input, {
            maxArrayItems: 2,
            maxDepth: 2,
            maxObjectKeys: 6,
            maxStringLength: 8,
        });

        expect(input['password']).toBe(TEST_SECRETS[2]);
        expect(input['items']).toBe(originalItems);
        expect(result).not.toBe(input);
        expect(() => serialized(result)).not.toThrow();
        expect(serialized(result)).not.toContain(TEST_SECRETS[2]);
        expect(serialized(result)).toContain('[Truncated');
    });

    it('preserves repeated non-circular references while still redacting them', () => {
        const shared = {
            operation: 'get_profile',
            password: TEST_SECRETS[2],
        };

        const result = redactSensitiveData({ first: shared, second: shared });

        expect(result).toEqual({
            first: {
                operation: 'get_profile',
                password: REDACTED_VALUE,
            },
            second: {
                operation: 'get_profile',
                password: REDACTED_VALUE,
            },
        });
    });
});
