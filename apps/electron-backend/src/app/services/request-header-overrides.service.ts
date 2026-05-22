import { session } from 'electron';

type HeaderOverride = {
    origin?: string;
    referer?: string;
    scopeOrigins: Set<string>;
    userAgent?: string;
};

const headerOverrideUrlFilter = {
    urls: ['http://*/*', 'https://*/*'],
};

let activeHeaderOverride: HeaderOverride | null = null;
let listenerRegistered = false;

function normalizeHeaderValue(value?: string | null): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function getOrigin(value?: string | null): string | undefined {
    const normalizedValue = normalizeHeaderValue(value);

    if (!normalizedValue) {
        return undefined;
    }

    try {
        return new URL(normalizedValue).origin;
    } catch {
        return undefined;
    }
}

function shouldApplyOverride(url: string, override: HeaderOverride): boolean {
    if (override.scopeOrigins.size === 0) {
        return true;
    }

    const requestOrigin = getOrigin(url);
    return Boolean(requestOrigin && override.scopeOrigins.has(requestOrigin));
}

function setRequestHeader(
    requestHeaders: Record<string, string>,
    headerName: string,
    headerValue: string
): void {
    const normalizedHeaderName = headerName.toLowerCase();
    const existingHeaderName = Object.keys(requestHeaders).find(
        (name) => name.toLowerCase() === normalizedHeaderName
    );

    if (existingHeaderName) {
        delete requestHeaders[existingHeaderName];
    }

    requestHeaders[headerName] = headerValue;
}

function handleBeforeSendHeaders(
    details: Electron.OnBeforeSendHeadersListenerDetails,
    callback: (beforeSendResponse: Electron.BeforeSendResponse) => void
): void {
    const requestHeaders = { ...details.requestHeaders };
    const override = activeHeaderOverride;

    if (!override || !shouldApplyOverride(details.url, override)) {
        callback({ requestHeaders });
        return;
    }

    if (override.userAgent) {
        setRequestHeader(requestHeaders, 'User-Agent', override.userAgent);
    }

    if (override.referer) {
        setRequestHeader(requestHeaders, 'Referer', override.referer);
    }

    if (override.origin) {
        setRequestHeader(requestHeaders, 'Origin', override.origin);
    }

    callback({ requestHeaders });
}

function ensureHeaderOverrideListener(): void {
    if (listenerRegistered) {
        return;
    }

    session.defaultSession.webRequest.onBeforeSendHeaders(
        headerOverrideUrlFilter,
        handleBeforeSendHeaders
    );
    listenerRegistered = true;
}

export function configureRequestHeaderOverride(
    userAgent?: string | null,
    referer?: string | null,
    scopeUrl?: string | null
): void {
    const normalizedUserAgent = normalizeHeaderValue(userAgent);
    const normalizedReferer = normalizeHeaderValue(referer);

    if (!normalizedUserAgent && !normalizedReferer) {
        clearRequestHeaderOverride();
        return;
    }

    const refererOrigin = getOrigin(normalizedReferer);
    const scopeOrigin = getOrigin(scopeUrl);
    const scopeOrigins = new Set(
        [scopeOrigin, refererOrigin].filter((origin): origin is string =>
            Boolean(origin)
        )
    );

    activeHeaderOverride = {
        origin: refererOrigin,
        referer: normalizedReferer,
        scopeOrigins,
        userAgent: normalizedUserAgent,
    };
    ensureHeaderOverrideListener();
}

export function clearRequestHeaderOverride(): void {
    activeHeaderOverride = null;
}
