/**
 * Pure helpers for Stalker portal endpoint discovery.
 *
 * The portal API endpoint cannot be derived reliably from the URL a user
 * pastes: `portal.php` is a reseller-panel alias that official
 * Stalker/Ministra never serves, while genuine installations answer at
 * `<base>/server/load.php` (optionally under `/stalker_portal`). Discovery
 * therefore probes concrete candidates and classifies each endpoint by how
 * it responds, instead of guessing from the URL shape (#850, #686, #755).
 */

import {
    isHostConnectivityFastFailMessage,
    isStalkerAuthFailureResponse,
} from '@iptvnator/shared/interfaces';

/**
 * Candidate API endpoints for a pasted portal URL, in probe order.
 *
 * An explicit `.php` endpoint pasted by the user (or persisted by a previous
 * import) always gets the first shot — nonstandard panel paths exist in the
 * wild and must not lose to the standard candidates. After that the order is
 * `portal.php` → `server/load.php` → `stalker_portal/server/load.php`, so
 * reseller panels resolve exactly as they did before discovery existed.
 */
/**
 * Reduces a pasted portal URL to `origin + pathname` (no query, no
 * fragment, no trailing slashes). Suffix logic anywhere in discovery must
 * run on this form: string-suffix matching on the raw URL would bolt
 * endpoint rewrites onto the query instead of the path. Returns null for
 * input the URL parser rejects.
 */
export function normalizeStalkerPortalInputUrl(rawUrl: string): string | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return null;
    }

    try {
        // Mutate the parsed URL instead of rebuilding from `origin`:
        // origin-reconstruction destroys authority information the import
        // validator accepts — file: URLs have origin "null" and basic-auth
        // credentials (user:pass@host) would be silently dropped.
        const parsed = new URL(trimmed);
        parsed.search = '';
        parsed.hash = '';
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        return parsed.href;
    } catch {
        return null;
    }
}

export function buildStalkerEndpointCandidates(rawUrl: string): string[] {
    // Queries and fragments are dropped from every candidate — the Stalker
    // API endpoints take their parameters per request, and a stored query
    // would collide with the transport's own query building.
    const normalized = normalizeStalkerPortalInputUrl(rawUrl);
    if (normalized === null) {
        return [];
    }

    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/\/+$/, '');
    // Candidates swap only the PATH: scheme, credentials, host and port of
    // the accepted URL are preserved verbatim.
    const candidateFrom = (candidatePath: string): string => {
        const candidate = new URL(parsed.href);
        candidate.pathname = candidatePath;
        return candidate.href;
    };

    const candidates: string[] = [];
    if (/\.php$/i.test(path)) {
        candidates.push(candidateFrom(path));
    }

    const base = /\.php$/i.test(path)
        ? // An endpoint file was pasted: strip only the FILE part. The `/c`
          // landing-page rewrite must not run here — a real installation
          // directory named `c` (`/tenant/c/portal.php`) would otherwise be
          // stripped too and the siblings probed one level too high.
          path
              .replace(/\/portal\.php$/i, '')
              .replace(/\/server\/load\.php$/i, '')
              // A nonstandard pasted endpoint (…/cp/api.php) keeps its
              // first-shot candidate above, but the standard fallbacks must
              // be its SIBLINGS — the directory, not the file.
              .replace(/\/[^/]*\.php$/i, '')
        : // The `/c` landing page users copy from the browser is not part
          // of the API path.
          path.replace(/\/c$/i, '');

    candidates.push(candidateFrom(`${base}/portal.php`));
    candidates.push(candidateFrom(`${base}/server/load.php`));
    // `<base>/server/load.php` already IS the canonical form when the base
    // ends in /stalker_portal — nesting it again would probe a path no
    // server has.
    if (!/\/stalker_portal(\/|$)/i.test(base)) {
        candidates.push(
            candidateFrom(`${base}/stalker_portal/server/load.php`)
        );
    }

    return [...new Set(candidates)];
}

/**
 * Auth-failure detection lives in `@iptvnator/shared/interfaces` so the
 * Electron main process — where these bodies actually arrive — and the
 * renderer classify identically. Re-exported here because discovery,
 * repair and the session service already import it from this module.
 */
export {
    isStalkerAuthFailureBody,
    isStalkerAuthFailureMessage,
    isStalkerAuthFailureResponse,
} from '@iptvnator/shared/interfaces';

export type StalkerProbeClassification =
    'data' | 'auth-required' | 'not-a-portal';

/**
 * Classifies what a token-less content request got back from a candidate
 * endpoint: real JSON data (token-free panel), the middleware's plain-text
 * auth failure (endpoint exists and enforces the token), or something that
 * is not a Stalker portal at all.
 */
export function classifyStalkerProbeResponse(
    response: unknown
): StalkerProbeClassification {
    if (isStalkerAuthFailureResponse(response)) {
        return 'auth-required';
    }

    if (response !== null && typeof response === 'object') {
        const js = (response as { js?: unknown }).js;
        // The probe asks for `itv/get_genres`, whose success shape is a
        // list (or a `{data: [...]}` envelope). A bare `js` key is NOT
        // enough: panels answer HTTP 200 with `{js: {error: "Unknown
        // action"}}` or `{js: false}`, and accepting those would end
        // discovery on a broken candidate and persist an empty catalog.
        if (Array.isArray(js)) {
            return 'data';
        }
        if (js !== null && typeof js === 'object') {
            const { data, error } = js as { data?: unknown; error?: unknown };
            if (Array.isArray(data) && error === undefined) {
                return 'data';
            }
        }
    }

    return 'not-a-portal';
}

/**
 * HTTP status carried by a failed Stalker transport call, when there is one.
 * The Electron handler rejects with an Error whose message is
 * `HTTP Error <code>: <statusText>` (network-level failures map to 500) —
 * but `ipcRenderer.invoke` strips every custom property from a rejected
 * value and re-wraps the message, so in the renderer the numeric `status`
 * field usually does NOT survive and the code must be parsed back out of
 * the message text.
 */
export function getStalkerRequestErrorStatus(
    error: unknown
): number | undefined {
    if (error === null || typeof error !== 'object') {
        return undefined;
    }

    if ('status' in error) {
        const status = (error as { status?: unknown }).status;
        if (typeof status === 'number') {
            return status;
        }
    }

    if ('message' in error) {
        const match = /HTTP Error (\d{3})\b/.exec(
            String((error as { message?: unknown }).message ?? '')
        );
        if (match) {
            return Number(match[1]);
        }
    }

    return undefined;
}

/**
 * Whether a status-less probe failure is a TIMEOUT (renderer probe budget,
 * axios request timeout, ETIMEDOUT). A timeout can be one hanging handler
 * while sibling endpoints answer fine, so discovery continues past it;
 * connection-level failures (ECONNREFUSED, ENOTFOUND, …) still stop the
 * loop — they prove the HOST is unreachable for every candidate.
 */
export function isStalkerProbeTimeout(error: unknown): boolean {
    if (error === null || typeof error !== 'object' || !('message' in error)) {
        return false;
    }

    const message = String((error as { message?: unknown }).message ?? '');
    // The connectivity guard's refusal names the portal endpoint, and a
    // hostname is user data. A guard refusal is a connection-level failure, so
    // it must not be read as one candidate hanging while its siblings answer.
    if (isHostConnectivityFastFailMessage(message)) {
        return false;
    }

    return /timed out|timeout of \d+\s*ms|ETIMEDOUT/i.test(message);
}

/**
 * The pre-discovery URL rewrite (`…/c` → `portal.php`, `…/stalker_portal/c`
 * → `…/stalker_portal/server/load.php`). Kept ONLY as the fallback for
 * imports where no candidate could be probed (host unreachable); discovery
 * results always win over this guess.
 */
export function legacyTransformStalkerPortalUrl(url: string): string {
    url = url.replace(/\/+$/, '');

    try {
        if (new URL(url).pathname === '/') {
            return `${url}/portal.php`;
        }
    } catch {
        // The import form validates URLs before this fallback runs. Preserve
        // the historical best-effort behavior for direct helper callers.
    }

    if (url.endsWith('/c')) {
        if (url.includes('/stalker_portal')) {
            return url.replace(
                /\/stalker_portal\/c$/,
                '/stalker_portal/server/load.php'
            );
        }
        return url.replace(/\/c$/, '/portal.php');
    }

    if (url.includes('/stalker_portal') && !url.includes('/server/load.php')) {
        if (url.endsWith('/stalker_portal')) {
            return url + '/server/load.php';
        }
        if (!url.endsWith('/load.php')) {
            return url.replace(
                /\/stalker_portal(\/.*)?$/,
                '/stalker_portal/server/load.php'
            );
        }
    }

    return url;
}
