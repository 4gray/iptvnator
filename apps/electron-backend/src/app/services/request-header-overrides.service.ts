import { session } from 'electron';
import {
    getOrigin,
    type HeaderOverride,
    normalizeHeaderValue,
    type ScopedHeaderOverride,
    selectScopedOverrides,
    shouldApplyOverride,
    toComparableUrl,
} from './request-header-override-matching';

export type StreamCredentialHeaders = {
    authorization?: string | null;
    cookie?: string | null;
};

/**
 * Owner of the scoped override every caller uses unless it names its own:
 * one inline player at a time, exactly the single slot this service had
 * before multiview. Only multiview tiles pass an owner of their own.
 */
export const DEFAULT_SCOPED_OVERRIDE_OWNER = 'default';

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
/** One scoped override per owner; see {@link DEFAULT_SCOPED_OVERRIDE_OWNER}. */
const scopedHeaderOverrides = new Map<string, ScopedHeaderOverride>();
let scopedOverrideSequence = 0;
let listenerRegistered = false;

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
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return;
    }
    // Scope strictly to embed player requests — www.youtube.com also
    // serves regular pages that must keep their real (missing) Referer
    if (
        !YOUTUBE_EMBED_HOSTS.has(parsed.hostname) ||
        !parsed.pathname.startsWith('/embed/')
    ) {
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
    const overrides: HeaderOverride[] =
        activeHeaderOverride &&
        shouldApplyOverride(details.url, activeHeaderOverride)
            ? [activeHeaderOverride]
            : [];
    if (scopedHeaderOverrides.size > 0) {
        overrides.push(
            ...selectScopedOverrides(
                details.url,
                scopedHeaderOverrides.values()
            )
        );
    }

    if (overrides.length === 0) {
        callback({ requestHeaders });
        return;
    }

    const requestOrigin = getOrigin(details.url);

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

        // Portal credentials are attached only to requests going to the
        // stream's own origin — never to a referer-origin sibling and never
        // to third-party hosts a manifest may point at.
        const credentialsApply =
            Boolean(override.credentialOrigin) &&
            requestOrigin === override.credentialOrigin;

        if (credentialsApply && override.cookie) {
            setRequestHeader(requestHeaders, 'Cookie', override.cookie);
        }

        if (credentialsApply && override.authorization) {
            setRequestHeader(
                requestHeaders,
                'Authorization',
                override.authorization
            );
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
    scopeUrl?: string | null,
    credentials?: StreamCredentialHeaders | null,
    origin?: string | null,
    ownerId: string = DEFAULT_SCOPED_OVERRIDE_OWNER
): void {
    const normalizedUserAgent = normalizeHeaderValue(userAgent);
    const normalizedReferer = normalizeHeaderValue(referer);
    const normalizedOrigin = normalizeHeaderValue(origin);
    const isScopedOverride = scopeUrl !== undefined && scopeUrl !== null;
    const scopeOrigin = getOrigin(scopeUrl);
    // Credentials are portal secrets: they require a scoped override whose
    // stream URL yields a concrete origin to pin them to. Anything else is
    // dropped rather than applied broadly (fail closed). They live only in
    // this in-memory override — never in the session cookie jar and never on
    // disk — so they cannot outlive the app process.
    const normalizedCookie =
        isScopedOverride && scopeOrigin
            ? normalizeHeaderValue(credentials?.cookie)
            : undefined;
    const normalizedAuthorization =
        isScopedOverride && scopeOrigin
            ? normalizeHeaderValue(credentials?.authorization)
            : undefined;

    if (
        !normalizedUserAgent &&
        !normalizedReferer &&
        !normalizedOrigin &&
        !normalizedCookie &&
        !normalizedAuthorization
    ) {
        if (isScopedOverride) {
            scopedHeaderOverrides.delete(ownerId);
        } else {
            clearRequestHeaderOverride();
        }
        return;
    }

    const refererOrigin = getOrigin(normalizedReferer);
    const override: HeaderOverride = {
        origin: normalizedOrigin ?? refererOrigin,
        referer: normalizedReferer,
        userAgent: normalizedUserAgent,
    };

    if (isScopedOverride) {
        override.scopeOrigins = new Set(
            [scopeOrigin, refererOrigin].filter((origin): origin is string =>
                Boolean(origin)
            )
        );
        if (normalizedCookie || normalizedAuthorization) {
            override.credentialOrigin = scopeOrigin;
            override.cookie = normalizedCookie;
            override.authorization = normalizedAuthorization;
        }
        scopedOverrideSequence += 1;
        scopedHeaderOverrides.set(ownerId, {
            ...override,
            scopeUrl: toComparableUrl(scopeUrl),
            sequence: scopedOverrideSequence,
        });
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
    scopedHeaderOverrides.clear();
}
