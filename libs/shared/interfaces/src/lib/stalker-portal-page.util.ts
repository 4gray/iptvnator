/**
 * Some portal hosts redirect every API path to the site root, which in turn
 * redirects to the HTML portal page (`…/stalker_portal/c/`) — possibly on a
 * different host. The page itself is useless as an API answer, but its
 * address is the only place the real installation is named, the same way a
 * set-top box finds it by following the redirects.
 *
 * Transports return this marker in place of such an HTML body so endpoint
 * discovery can derive candidates from where the redirects actually ended.
 * Returned, never thrown, for the same reason as the auth-failure marker:
 * custom properties do not survive a rejected `ipcRenderer.invoke`.
 */
export interface StalkerPortalPageMarker {
    /** The landing page's `origin + pathname`, without query or credentials. */
    stalkerPortalPage: string;
}

/** `…/c`, `…/c/` or `…/c/index.html` — the browser entry point of a portal. */
const PORTAL_PAGE_PATH = /\/c(?:\/(?:index\.html?)?)?$/i;
const HTML_PAGE_START =
    /^\s*(?:<!doctype\s+html\b|<(?:html|head|body|title|meta|script)[\s/>])/i;

/**
 * Builds the marker when an HTML body was served from a portal page
 * address. Returns null for everything else, so API answers, auth-failure
 * bodies and unrelated HTML keep their existing handling.
 */
function createStalkerPortalPageMarker(
    body: unknown,
    finalUrl: string | undefined
): StalkerPortalPageMarker | null {
    if (typeof body !== 'string' || !finalUrl || !HTML_PAGE_START.test(body)) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(finalUrl);
    } catch {
        return null;
    }

    if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        !PORTAL_PAGE_PATH.test(parsed.pathname)
    ) {
        return null;
    }

    return { stalkerPortalPage: `${parsed.origin}${parsed.pathname}` };
}

/** Only the transport can report where a portal request landed. */
export function normalizeStalkerPortalPageResponse(
    body: unknown,
    finalUrl: string | undefined
): unknown {
    if (
        body !== null &&
        typeof body === 'object' &&
        'stalkerPortalPage' in body
    ) {
        const payload: Record<string, unknown> = { ...body };
        delete payload['stalkerPortalPage'];
        return payload;
    }
    return createStalkerPortalPageMarker(body, finalUrl) ?? body;
}

/** The landing page address carried by a portal-page marker, if any. */
export function readStalkerPortalPageUrl(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const page = (value as Partial<StalkerPortalPageMarker>).stalkerPortalPage;
    return typeof page === 'string' && page.length > 0 ? page : null;
}
