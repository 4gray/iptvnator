const STREAM_PATH_EXTENSION =
    /\.(?:avi|flv|m3u|m3u8|mkv|mov|mp4|mpeg|mpg|mpd|ts|webm|wmv)(?:\/|$)/i;

const CREDENTIAL_QUERY_TERMS = [
    'authentication',
    'authorization',
    'cookie',
    'credential',
    'macaddress',
    'oauth',
    'password',
    'passwd',
    'secret',
    'session',
    'signature',
    'token',
];

function invalidArtworkUrl(): never {
    throw new Error('Invalid download metadata snapshot');
}

function isCredentialQueryKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
        normalized === 'auth' ||
        normalized === 'key' ||
        normalized === 'mac' ||
        normalized === 'sig' ||
        normalized.endsWith('auth') ||
        normalized.endsWith('mac')
    ) {
        return true;
    }
    if (CREDENTIAL_QUERY_TERMS.some((term) => normalized.includes(term))) {
        return true;
    }
    return [
        'accesskey',
        'apikey',
        'privatekey',
        'secretkey',
        'signingkey',
    ].some((term) => normalized.includes(term));
}

function getDecodedPathname(url: URL): string {
    try {
        return decodeURIComponent(url.pathname).replace(/\/+$/, '');
    } catch {
        return invalidArtworkUrl();
    }
}

export function normalizeDownloadArtworkUrl(
    value: unknown
): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        return invalidArtworkUrl();
    }

    const normalized = value.trim();
    let url: URL;
    try {
        url = new URL(normalized);
    } catch {
        return invalidArtworkUrl();
    }
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== '' ||
        [...url.searchParams.keys()].some(isCredentialQueryKey) ||
        STREAM_PATH_EXTENSION.test(getDecodedPathname(url))
    ) {
        return invalidArtworkUrl();
    }
    return normalized;
}
