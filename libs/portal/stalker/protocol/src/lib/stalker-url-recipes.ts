import { STALKER_ENDPOINT_CANDIDATE_LIMIT } from './stalker-protocol.constants';

const CREDENTIAL_QUERY_KEYS = new Set([
    'access_token',
    'api_signature',
    'auth',
    'auth_second_step',
    'authorization',
    'bearer',
    'cookie',
    'credentials',
    'device_id',
    'device_id1',
    'device_id2',
    'login',
    'mac',
    'not_valid_token',
    'password',
    'prehash',
    'random',
    'refresh_token',
    'serial',
    'serial_number',
    'session',
    'session_id',
    'signature',
    'signature2',
    'sn',
    'token',
    'username',
]);

export class StalkerProtocolInputError extends Error {
    constructor(public readonly reason: 'invalid-url') {
        super(reason);
        this.name = 'StalkerProtocolInputError';
    }
}

export function normalizeStalkerSourceUrl(sourceUrl: string): string {
    let parsed: URL;

    try {
        parsed = new URL(sourceUrl);
    } catch {
        throw new StalkerProtocolInputError('invalid-url');
    }

    if (
        hasAuthorityUserInfo(sourceUrl) ||
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username ||
        parsed.password ||
        hasCredentialQueryKey(parsed)
    ) {
        throw new StalkerProtocolInputError('invalid-url');
    }

    parsed.hash = '';
    return parsed.toString();
}

function hasAuthorityUserInfo(sourceUrl: string): boolean {
    const trimmed = sourceUrl.trim();
    const schemeSeparator = trimmed.indexOf('://');
    if (schemeSeparator === -1) {
        return false;
    }
    const authorityStart = schemeSeparator + 3;
    const authorityEndOffset = trimmed
        .slice(authorityStart)
        .search(/[/?#]/);
    const authorityEnd =
        authorityEndOffset === -1
            ? trimmed.length
            : authorityStart + authorityEndOffset;
    return trimmed.slice(authorityStart, authorityEnd).includes('@');
}

export function deriveStalkerEndpointCandidates(
    sourceUrl: string
): readonly string[] {
    const normalizedSourceUrl = normalizeStalkerSourceUrl(sourceUrl);
    const parsed = new URL(normalizedSourceUrl);
    const pathname = parsed.pathname;
    const lowerPathname = pathname.toLowerCase();
    const candidates: string[] = [];

    if (
        lowerPathname.endsWith('/portal.php') ||
        lowerPathname.endsWith('/server/load.php')
    ) {
        candidates.push(toCandidateUrl(parsed, pathname));
        return deduplicateAndLimitStalkerEndpointCandidates(candidates);
    }

    const cParentPath = getCParentPath(pathname);
    if (cParentPath !== undefined) {
        candidates.push(
            toCandidateUrl(parsed, joinPath(cParentPath, 'server/load.php')),
            toCandidateUrl(parsed, joinPath(cParentPath, 'portal.php'))
        );
        return deduplicateAndLimitStalkerEndpointCandidates(candidates);
    }

    const directoryPath = getDirectoryPath(pathname);
    candidates.push(
        toCandidateUrl(parsed, joinPath(directoryPath, 'server/load.php')),
        toCandidateUrl(parsed, joinPath(directoryPath, 'portal.php'))
    );

    if (directoryPath === '/') {
        candidates.push(
            toCandidateUrl(parsed, '/stalker_portal/server/load.php'),
            toCandidateUrl(parsed, '/stalker_portal/portal.php')
        );
    }

    return deduplicateAndLimitStalkerEndpointCandidates(candidates);
}

export function deduplicateAndLimitStalkerEndpointCandidates(
    candidates: readonly string[]
): readonly string[] {
    return [...new Set(candidates)].slice(0, STALKER_ENDPOINT_CANDIDATE_LIMIT);
}

function hasCredentialQueryKey(url: URL): boolean {
    let credentialKeyFound = false;
    url.searchParams.forEach((_value, key) => {
        if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) {
            credentialKeyFound = true;
        }
    });
    return credentialKeyFound;
}

function getCParentPath(pathname: string): string | undefined {
    const segments = pathname.split('/').filter(Boolean);
    const cIndex = segments.findIndex(
        (segment) => segment.toLowerCase() === 'c'
    );

    if (cIndex === -1) {
        return undefined;
    }

    const remaining = segments.slice(cIndex + 1);
    if (
        remaining.length > 1 ||
        (remaining.length === 1 &&
            !remaining[0]?.toLowerCase().startsWith('index.'))
    ) {
        return undefined;
    }

    return `/${segments.slice(0, cIndex).join('/')}`;
}

function getDirectoryPath(pathname: string): string {
    if (pathname.endsWith('/')) {
        return pathname;
    }

    const lastSlash = pathname.lastIndexOf('/');
    const lastSegment = pathname.slice(lastSlash + 1);
    return lastSegment.includes('.')
        ? pathname.slice(0, lastSlash + 1)
        : pathname;
}

function joinPath(directory: string, suffix: string): string {
    const normalizedDirectory =
        directory === '/' ? '' : directory.replace(/\/+$/, '');
    return `${normalizedDirectory}/${suffix}`;
}

function toCandidateUrl(base: URL, pathname: string): string {
    const candidate = new URL(base.origin);
    candidate.pathname = pathname;
    return candidate.toString();
}
