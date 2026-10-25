import { normalizeStalkerMacAddress } from '@iptvnator/shared/interfaces';
import { httpUrl, Source } from './index';
export type SourceDraft = Omit<Source, 'id' | 'endpoint' | 'full' | 'token'>;
/** Narrow incoming phone data; transport/session fields never cross this boundary. */
export function parseSourceDraft(value: unknown): SourceDraft {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Enter source details.');
    const raw = value as Record<string, unknown>;
    const field = (key: string, trim = true) => {
        const value = raw[key];
        if (value !== undefined && typeof value !== 'string')
            throw new Error('Invalid source field.');
        const text = typeof value === 'string' ? value : '';
        if (text.length > (key === 'url' ? 4096 : 512))
            throw new Error('Source field is too long.');
        return trim ? text.trim() : text;
    };
    const provider = field('provider');
    if (!['xtream', 'stalker', 'm3u'].includes(provider))
        throw new Error('Choose a source type.');
    const name = field('name');
    if (!name || name.length > 100)
        throw new Error('Enter a name (up to 100 characters).');
    const source: SourceDraft = {
        name,
        provider: provider as Source['provider'],
        url: httpUrl(field('url')),
    };
    if (provider !== 'm3u') {
        source.username = field('username');
        source.password = field('password', provider !== 'stalker');
        if (provider === 'xtream' && (!source.username || !source.password))
            throw new Error('Enter the Xtream username and password.');
    }
    if (provider === 'stalker') {
        const mac = normalizeStalkerMacAddress(field('macAddress'));
        if (!mac) throw new Error('Enter a valid MAG MAC address.');
        source.macAddress = mac;
        for (const key of [
            'serialNumber',
            'deviceId1',
            'deviceId2',
            'signature1',
            'signature2',
        ] as const)
            source[key] = field(key, false);
    }
    return source;
}
