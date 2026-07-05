import { session } from 'electron';

type HeaderOverride = {
    origin?: string;
    referer?: string;
    scopeOrigins?: Set<string>;
    userAgent?: string;
};

const headerOverrideUrlFilter = {
    urls: ['http://*/*', 'https://*/*'],
};

/**
 * YouTube refuses to configure the embedded player when the /embed request
 * carries no Referer ("Error 153 — Video player configuration error").
 * The packaged app loads the renderer from file://, which never sends a
 * Referer, so trailer iframes break in production while working in dev
 * (localhost origin). Injecting the project site as Referer restores them.
 */
const YOUTUBE_EMBED_HOSTS = new Set([
    'www.youtube-nocookie.com',
    'www.youtube.com',
]);
const YOUTUBE_EMBED_REFERER = 'https://4gray.github.io/iptvnator/';

let activeHeaderOverride: HeaderOverride | null = null;
let activeScopedHeaderOverride: HeaderOverride | null = null;
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
    if (!override.scopeOrigins) {
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

function applyYoutubeEmbedRefererShim(
    url: string,
    requestHeaders: Record<string, string>
): void {
    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        return;
    }
    if (!YOUTUBE_EMBED_HOSTS.has(host)) {
        return;
    }

    const hasReferer = Object.keys(requestHeaders).some(
        (name) => name.toLowerCase() === 'referer'
    );
    if (!hasReferer) {
        requestHeaders['Referer'] = YOUTUBE_EMBED_REFERER;
    }
}

function handleBeforeSendHeaders(
    details: Electron.OnBeforeSendHeadersListenerDetails,
    callback: (beforeSendResponse: Electron.BeforeSendResponse) => void
): void {
    const requestHeaders = { ...details.requestHeaders };
    applyYoutubeEmbedRefererShim(details.url, requestHeaders);
    const overrides = [activeHeaderOverride, activeScopedHeaderOverride].filter(
        (override): override is HeaderOverride =>
            Boolean(override && shouldApplyOverride(details.url, override))
    );

    if (overrides.length === 0) {
        callback({ requestHeaders });
        return;
    }

    for (const override of overrides) {
        if (override.userAgent) {
            setRequestHeader(requestHeaders, 'User-Agent', override.userAgent);
        }

        if (override.referer) {
            setRequestHeader(requestHeaders, 'Referer', override.referer);
        }

        if (override.origin) {
            setRequestHeader(requestHeaders, 'Origin', override.origin);
        }
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
    const isScopedOverride = scopeUrl !== undefined && scopeUrl !== null;

    if (!normalizedUserAgent && !normalizedReferer) {
        if (isScopedOverride) {
            clearScopedRequestHeaderOverride();
        } else {
            clearRequestHeaderOverride();
        }
        return;
    }

    const refererOrigin = getOrigin(normalizedReferer);
    const scopeOrigin = getOrigin(scopeUrl);
    const override: HeaderOverride = {
        origin: refererOrigin,
        referer: normalizedReferer,
        userAgent: normalizedUserAgent,
    };

    if (isScopedOverride) {
        override.scopeOrigins = new Set(
            [scopeOrigin, refererOrigin].filter((origin): origin is string =>
                Boolean(origin)
            )
        );
        activeScopedHeaderOverride = override;
    } else {
        activeHeaderOverride = override;
    }

    ensureHeaderOverrideListener();
}

/**
 * Registers the header listener at startup so the YouTube embed Referer
 * shim is active even before any playlist-level override is configured.
 */
export function registerStaticHeaderShims(): void {
    ensureHeaderOverrideListener();
}

export function clearRequestHeaderOverride(): void {
    activeHeaderOverride = null;
    activeScopedHeaderOverride = null;
}

function clearScopedRequestHeaderOverride(): void {
    activeScopedHeaderOverride = null;
}
