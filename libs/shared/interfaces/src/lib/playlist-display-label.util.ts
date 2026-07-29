/**
 * A short, safe label for a playlist.
 *
 * Users routinely name a playlist after the URL they pasted, and those URLs
 * carry `username=` / `password=` query parameters — or even
 * `usr== X pas== Y` typed into the name by hand. Rendering that verbatim puts
 * live credentials on screen in a list that exists to be looked at, screenshotted
 * and screen-shared.
 *
 * So anything URL-shaped collapses to its host, and any credential-looking
 * fragment is dropped. A name the user actually chose is left alone.
 */

/** Query keys whose presence means the string is a credential-bearing URL. */
const CREDENTIAL_KEYS = /(?:^|[?&;])(?:username|password|user|pass|token|auth)=/i;

/** Hand-typed credential fragments, e.g. "usr== Tl24uy0xGi pas== abc". */
const INLINE_CREDENTIALS =
    /\b(?:usr|user|username|pas|pass|password|login|token)\s*[:=]+\s*\S+/gi;

const MAX_LABEL_LENGTH = 42;

/**
 * Turn a stored playlist name into something short enough to scan and safe
 * enough to show. Never returns an empty string when given any input, so a row
 * can always be identified by something.
 */
export function playlistDisplayLabel(
    rawName: string | null | undefined,
    fallback = ''
): string {
    const name = (rawName ?? '').trim();
    if (!name) {
        return fallback;
    }

    const host = extractHost(name);
    if (host) {
        return host;
    }

    // Not a URL, but may still have credentials typed into the name.
    const cleaned = name
        .replace(INLINE_CREDENTIALS, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const safe = cleaned || fallback || 'Playlist';
    return safe.length > MAX_LABEL_LENGTH
        ? `${safe.slice(0, MAX_LABEL_LENGTH - 1).replace(/\s+$/, '')}…`
        : safe;
}

/** True when the stored name would have leaked credentials as-is. */
export function playlistNameHasCredentials(
    rawName: string | null | undefined
): boolean {
    const name = rawName ?? '';
    return CREDENTIAL_KEYS.test(name) || INLINE_CREDENTIALS.test(name);
}

/**
 * The host of the first URL in the string, port included.
 *
 * Handles both a clean URL and the common "http://host:8080 user== x pas== y"
 * shape, where the credentials sit outside the URL entirely.
 */
function extractHost(value: string): string | null {
    const match = value.match(/https?:\/\/[^\s/?#]+/i);
    if (!match) {
        return null;
    }

    try {
        const url = new URL(match[0]);
        return url.host || null;
    } catch {
        // Malformed but clearly URL-shaped — strip the scheme by hand rather
        // than fall through and render the credential-bearing remainder.
        return match[0].replace(/^https?:\/\//i, '') || null;
    }
}
