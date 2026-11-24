import { resolve } from 'node:path';
import { type HostedServerMode } from '@iptvnator/shared/interfaces';
import {
    checkHostedPublicRoute,
    validateHostedMode,
    validateHostedTunnelToken,
} from './hosted-mode-config';

const address = '192.0.2.10';
const origin = 'https://library.example.test';
const https = {
    mode: 'https',
    origin,
    address,
    certificatePath: resolve('test-cert.pem'),
    keyPath: resolve('test-key.pem'),
} satisfies HostedServerMode;
const cloudflare = {
    mode: 'cloudflare',
    origin,
    certificatePath: '',
    keyPath: '',
    team: 'example-team',
    audience: 'a'.repeat(64),
    managed: true,
} satisfies HostedServerMode;

describe('hosted mode configuration', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([null, 'https', {}, { mode: 'unknown' }])(
        'rejects an invalid mode: %j',
        (value) =>
            expect(() => validateHostedMode(value, [])).toThrow(
                'Invalid hosted server mode'
            )
    );

    it('upgrades old open-sharing profiles to paired access on their saved interface', () => {
        expect(
            validateHostedMode({ mode: 'lan', address, access: 'open' }, [
                address,
            ])
        ).toEqual({
            mode: 'lan',
            address,
            access: 'paired',
        });
        for (const value of [
            { address: '', access: 'open' },
            { address: '192.0.2.20', access: 'paired' },
            { address, access: 'unknown' },
        ]) {
            expect(() =>
                validateHostedMode({ mode: 'lan', ...value }, [address])
            ).toThrow('Home network');
        }
    });

    it('requires both absolute TLS paths for HTTPS and optional tunnel TLS', () => {
        expect(validateHostedMode(https, [address])).toEqual(https);
        expect(() => validateHostedMode(https, [])).toThrow(
            'Invalid HTTPS interface'
        );
        expect(() =>
            validateHostedMode({ ...https, certificatePath: 'relative.pem' }, [
                address,
            ])
        ).toThrow('absolute certificate');
        expect(validateHostedMode(cloudflare, [])).toEqual(cloudflare);
        expect(() =>
            validateHostedMode(
                { ...cloudflare, certificatePath: https.certificatePath },
                []
            )
        ).toThrow('absolute certificate');
        expect(() =>
            validateHostedMode({ ...cloudflare, audience: 'short' }, [])
        ).toThrow('Invalid Cloudflare Access settings');
    });

    it('accepts new connector credentials only for managed tunnels', () => {
        const connectorToken = 'synthetic_token_example';
        expect(validateHostedTunnelToken({}, cloudflare)).toBeUndefined();
        expect(validateHostedTunnelToken({ connectorToken }, cloudflare)).toBe(
            connectorToken
        );
        expect(() =>
            validateHostedTunnelToken({ connectorToken }, https)
        ).toThrow('Invalid tunnel token');
        expect(() =>
            validateHostedTunnelToken(
                { connectorToken },
                { ...cloudflare, managed: false }
            )
        ).toThrow('Invalid tunnel token');
        expect(() =>
            validateHostedTunnelToken({ connectorToken: 10 }, cloudflare)
        ).toThrow('Invalid tunnel token');
        expect(() =>
            validateHostedTunnelToken({ connectorToken: 'short' }, cloudflare)
        ).toThrow('Invalid tunnel token');
    });

    it('requires an Access challenge on the public API and treats network errors as unverified', async () => {
        const fetch = jest.spyOn(globalThis, 'fetch');
        fetch.mockResolvedValueOnce(
            new Response(null, {
                status: 401,
                headers: {
                    'www-authenticate':
                        'Bearer resource_metadata="https://library.example.test/.well-known/example"',
                },
            })
        );
        await expect(checkHostedPublicRoute(origin)).resolves.toBe(
            'access-protected'
        );
        expect(fetch).toHaveBeenCalledWith(
            new URL('/api/v1/instance', origin),
            expect.objectContaining({ redirect: 'manual' })
        );
        fetch.mockResolvedValueOnce(new Response('Sign in', { status: 401 }));
        await expect(checkHostedPublicRoute(origin)).resolves.toBe(
            'unverified'
        );
        fetch.mockRejectedValueOnce(new Error('synthetic DNS failure'));
        await expect(checkHostedPublicRoute(origin)).resolves.toBe(
            'unverified'
        );
    });
});
