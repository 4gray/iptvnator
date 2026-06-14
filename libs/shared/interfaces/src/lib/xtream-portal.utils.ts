export type XtreamPortalStatusType =
    | 'active'
    | 'inactive'
    | 'expired'
    | 'unavailable';

export interface XtreamPortalStatusResponseLike {
    user_info?: {
        auth?: boolean | number | string | null;
        exp_date?: number | string | null;
        status?: string | null;
    } | null;
}

export interface XtreamCredentialsFromUrl {
    password: string;
    username: string;
}

const XTREAM_API_ENDPOINT_PATTERN = /\/(?:get|player_api)\.php$/i;

export function normalizeXtreamServerUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Xtream URL is required');
    }

    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https Xtream URLs are supported');
    }

    if (url.username || url.password) {
        throw new Error('URL credentials are not supported');
    }

    const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, '');
    const basePath = pathWithoutTrailingSlash.replace(
        XTREAM_API_ENDPOINT_PATTERN,
        ''
    );

    return `${url.origin}${basePath}`;
}

export function extractXtreamCredentialsFromUrl(
    value: string
): XtreamCredentialsFromUrl | null {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }

    const username = url.searchParams.get('username')?.trim() ?? '';
    const password = url.searchParams.get('password')?.trim() ?? '';

    if (!username || !password) {
        return null;
    }

    return { username, password };
}

export function resolveXtreamPortalStatus(
    response: XtreamPortalStatusResponseLike | null | undefined,
    now = new Date()
): XtreamPortalStatusType {
    const userInfo = response?.user_info;
    if (!userInfo) {
        return 'unavailable';
    }

    const auth = normalizeAuthValue(userInfo.auth);
    if (auth === false) {
        return 'inactive';
    }

    const normalizedStatus = userInfo.status?.trim().toLowerCase() ?? '';
    if (normalizedStatus === 'expired') {
        return 'expired';
    }

    const isActive =
        normalizedStatus === 'active' ||
        (auth === true && normalizedStatus.length === 0);

    if (!isActive) {
        return normalizedStatus ? 'inactive' : 'unavailable';
    }

    const expirationTimestamp = parseXtreamExpiration(userInfo.exp_date);
    if (
        expirationTimestamp !== null &&
        expirationTimestamp * 1000 < now.getTime()
    ) {
        return 'expired';
    }

    return 'active';
}

function normalizeAuthValue(
    value: boolean | number | string | null | undefined
): boolean | null {
    if (value === true || value === 1 || value === '1') {
        return true;
    }

    if (value === false || value === 0 || value === '0') {
        return false;
    }

    return null;
}

function parseXtreamExpiration(
    value: number | string | null | undefined
): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}
