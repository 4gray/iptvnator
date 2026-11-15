import { isAbsolute } from 'node:path';
import {
    parseHostedHttpsOrigin,
    type HostedServerMode,
} from '@iptvnator/shared/interfaces';

export function validateHostedMode(
    value: unknown,
    addresses: string[]
): HostedServerMode {
    if (!value || typeof value !== 'object' || !('mode' in value))
        throw new Error('Invalid hosted server mode');
    const configuration = value as HostedServerMode;
    const validAddress = (address: unknown): address is string =>
        typeof address === 'string' &&
        (!address || addresses.includes(address));
    if (configuration.mode === 'lan') {
        const { address, access } = configuration;
        if (
            !validAddress(address) ||
            (access !== 'paired' && access !== 'open') ||
            (!address && access === 'open')
        )
            throw new Error('Invalid Home network settings');
        return { mode: 'lan', address, access };
    }
    if (configuration.mode !== 'https' && configuration.mode !== 'cloudflare')
        throw new Error('Invalid hosted server mode');
    const { mode, certificatePath, keyPath } = configuration;
    const origin = parseHostedHttpsOrigin(configuration.origin).origin;
    if (
        (mode === 'https' || (mode === 'cloudflare' && (certificatePath || keyPath))) &&
        (typeof certificatePath !== 'string' ||
            !isAbsolute(certificatePath) ||
            typeof keyPath !== 'string' ||
            !isAbsolute(keyPath))
    )
        throw new Error(
            'TLS requires absolute certificate and private key paths'
        );
    if (configuration.mode === 'cloudflare') {
        const { team, audience, managed } = configuration;
        if (
            !/^[a-z0-9-]{1,63}$/.test(team) ||
            !/^[a-f0-9]{64}$/.test(audience) ||
            typeof managed !== 'boolean'
        )
            throw new Error('Invalid Cloudflare Access settings');
        return {
            mode: 'cloudflare',
            origin,
            certificatePath: certificatePath || '',
            keyPath: keyPath || '',
            team,
            audience,
            managed,
        };
    }
    if (!validAddress(configuration.address))
        throw new Error('Invalid HTTPS interface');
    return {
        mode: 'https',
        origin,
        address: configuration.address,
        certificatePath,
        keyPath,
    };
}

export async function checkHostedPublicRoute(
    origin: string
): Promise<'access-protected' | 'unverified'> {
    try {
        const response = await fetch(new URL('/api/v1/instance', origin), {
            redirect: 'manual',
            signal: AbortSignal.timeout(4000),
        });
        void response.body?.cancel().catch(() => undefined);
        if (
            response.status === 401 &&
            response.headers
                .get('www-authenticate')
                ?.includes('resource_metadata=')
        )
            return 'access-protected';
    } catch {
        // Public DNS, TLS, or Access might still be provisioning.
    }
    return 'unverified';
}
