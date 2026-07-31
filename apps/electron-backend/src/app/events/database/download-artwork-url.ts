const IMAGE_PATH_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

const TRUSTED_IMAGE_HOSTS = new Set(['image.tmdb.org', 'picsum.photos']);

const IMAGE_PATH_HINTS = new Set([
    'backdrop',
    'backdrops',
    'cover',
    'covers',
    'getimage',
    'image',
    'images',
    'logo',
    'logos',
    'poster',
    'posters',
    'still',
    'stills',
]);

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
    return isCredentialToken(normalizeToken(key));
}

function isCredentialToken(normalized: string): boolean {
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

function normalizeToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getDecodedPathname(url: URL): string {
    try {
        return decodeURIComponent(url.pathname).replace(/\/+$/, '');
    } catch {
        return invalidArtworkUrl();
    }
}

function hasPositiveImageSignal(url: URL, decodedPathname: string): boolean {
    if (
        IMAGE_PATH_EXTENSION.test(decodedPathname) ||
        TRUSTED_IMAGE_HOSTS.has(url.hostname)
    ) {
        return true;
    }
    const hasImagePathHint = decodedPathname
        .split('/')
        .filter(Boolean)
        .some((segment) => IMAGE_PATH_HINTS.has(normalizeToken(segment)));
    if (hasImagePathHint) {
        return true;
    }
    return [...url.searchParams.entries()].some(
        ([key, value]) =>
            ['action', 'method'].includes(normalizeToken(key)) &&
            ['getimage', 'image'].includes(normalizeToken(value))
    );
}

export function getNormalizedDownloadUrlIdentity(
    value: string
): string | undefined {
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return undefined;
        }
        return url.href;
    } catch {
        return undefined;
    }
}

export function normalizeDownloadArtworkUrl(
    value: unknown
): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        return invalidArtworkUrl();
    }

    const normalized = value.trim();
    if (normalized === '') {
        return undefined;
    }
    let url: URL;
    try {
        url = new URL(normalized);
    } catch {
        return invalidArtworkUrl();
    }
    const decodedPathname = getDecodedPathname(url);
    const hasCredentialPathToken = decodedPathname
        .split('/')
        .filter(Boolean)
        .some((segment) => isCredentialToken(normalizeToken(segment)));
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== '' ||
        url.hash !== '' ||
        [...url.searchParams.keys()].some(isCredentialQueryKey) ||
        hasCredentialPathToken ||
        !hasPositiveImageSignal(url, decodedPathname)
    ) {
        return invalidArtworkUrl();
    }
    return normalized;
}
