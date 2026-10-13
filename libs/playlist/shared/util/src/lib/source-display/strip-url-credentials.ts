import {
    isSensitiveKey,
    looksLikeSearchParams,
    XTREAM_CREDENTIAL_PATH_SEGMENTS,
} from '@iptvnator/shared/logging';

/**
 * Short account keys some playlist URLs use. A log line keeps them for
 * diagnosis; a list on screen has no reason to.
 */
const SHORT_ACCOUNT_KEYS = new Set(['user', 'usr', 'pass', 'pas']);

/** How deep URLs nested in URLs are cleaned; anything deeper is dropped. */
const MAX_NESTING = 4;
/** Percent-decoding rounds a nested value gets before it is classified. */
const MAX_DECODE_ROUNDS = 4;
// Linear on any input: a match starts only where a name can start (the
// lookbehinds), and every name part is bounded, so a long run of letters
// cannot make a scan retry from each position.
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]{0,31}:\/\//iu;
const EMBEDDED_URL = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\/[^\s"'<>]+/giu;
/** `joe:hunter2@origin.test`: an authority's userinfo without a scheme. */
const BARE_USERINFO = /(?:^|[\s/])[^\s/:@]{1,256}:[^\s/@]{0,256}@[^\s/@]/u;
const KEYED_PAIR = /(?<![a-z0-9_.-])([a-z][a-z0-9_.-]{0,63})\s{0,8}[=:]/giu;

/**
 * A nested value as it must be classified: percent-decoded one round at a
 * time until it reads as a URL or a parameter list, or stops changing, so a
 * URL encoded twice (`https%253A%252F%252F…`) is cleaned as the URL it is.
 * A URL found is not decoded further: its own encoded parameters stay
 * intact for the next level. Null when it is still encoded after the last
 * round: it cannot be shown as safe.
 */
export function unwrapNestedValue(value: string): string | null {
    let current = value;
    for (let round = 0; ; round += 1) {
        const trimmed = current.trim();
        if (ABSOLUTE_URL.test(trimmed) || looksLikeSearchParams(trimmed)) {
            return current;
        }
        let next: string;
        try {
            next = decodeURIComponent(current);
        } catch {
            // A stray `%` (`100%`) is text, not an escape.
            return current;
        }
        if (next === current) {
            return current;
        }
        if (round === MAX_DECODE_ROUNDS) {
            return null;
        }
        current = next;
    }
}

/**
 * The two segments after a `/live/`-style marker are an Xtream account only
 * when a stream follows them (`/live/<user>/<password>/<id>.ts`); a playlist
 * path such as `/live/news/list.m3u` names no account.
 */
export function isXtreamAccountPath(
    segments: readonly string[],
    index: number
): boolean {
    return (
        XTREAM_CREDENTIAL_PATH_SEGMENTS.has(segments[index].toLowerCase()) &&
        index + 3 < segments.length
    );
}

function isDisplaySensitiveKey(key: string): boolean {
    return SHORT_ACCOUNT_KEYS.has(key.toLowerCase()) || isSensitiveKey(key);
}

/** Free text that names a secret, such as `token=…` or `password: …`. */
function hasSensitivePair(value: string): boolean {
    const pairs = new RegExp(KEYED_PAIR.source, KEYED_PAIR.flags);
    for (let match = pairs.exec(value); match; match = pairs.exec(value)) {
        if (isDisplaySensitiveKey(match[1])) {
            return true;
        }
    }
    return false;
}

/**
 * A kept URL part (a parameter value or a path segment) with any URL,
 * parameter list or credential nested in it cleaned the same way, or null
 * when it cannot be shown safely and must be dropped.
 */
function sanitizeNested(value: string, depth: number): string | null {
    const decoded = unwrapNestedValue(value);
    if (depth >= MAX_NESTING || decoded === null) {
        return null;
    }
    const trimmed = decoded.trim();
    if (ABSOLUTE_URL.test(trimmed)) {
        return stripUrl(trimmed, depth + 1);
    }
    if (looksLikeSearchParams(trimmed)) {
        return withoutSensitiveParams(new URLSearchParams(trimmed), depth + 1);
    }
    if (BARE_USERINFO.test(decoded) || hasSensitivePair(decoded)) {
        return null;
    }
    const cleaned = decoded.replace(
        EMBEDDED_URL,
        (candidate) => stripUrl(candidate, depth + 1) ?? ''
    );
    // Nothing to clean: keep the value as it was written.
    return cleaned === decoded ? value : cleaned;
}

function withoutSensitiveParams(
    params: URLSearchParams,
    depth: number
): string {
    const kept = new URLSearchParams();
    params.forEach((value, key) => {
        if (isDisplaySensitiveKey(key)) {
            return;
        }
        const clean = sanitizeNested(value, depth);
        if (clean !== null) {
            kept.append(key, clean);
        }
    });
    return kept.toString();
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function stripUrl(value: string, depth: number): string | null {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }

    url.username = '';
    url.password = '';

    const segments = url.pathname.split('/');
    const decodedSegments = segments.map(decodeSegment);
    const kept: string[] = [];
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const decoded = decodedSegments[index];
        const clean = sanitizeNested(decoded, depth);
        if (clean !== null) {
            kept.push(clean === decoded ? segment : encodeURIComponent(clean));
        }
        // `/LIVE/…` and `/%6Cive/…` mark account segments as `/live/…` does.
        if (isXtreamAccountPath(decodedSegments, index)) {
            index += 2;
        }
    }
    url.pathname = kept.join('/');

    const search = withoutSensitiveParams(url.searchParams, depth);
    url.search = search ? `?${search}` : '';

    // Any fragment, not only a parameter list: `#https://joe:pw@…` is a URL.
    const fragment = url.hash.slice(1);
    if (fragment) {
        const clean = sanitizeNested(fragment, depth);
        if (!clean) {
            url.hash = '';
        } else if (clean !== fragment) {
            url.hash = clean;
        }
    }

    return url.toString();
}

/**
 * A URL safe to show on screen. It lives beside its only consumer
 * (`source-display`): behind the shared logging barrel, which startup code
 * imports, it rode into the initial bundle.
 * Where the log redactor replaces secrets with
 * a marker, this drops them: the userinfo, every query or fragment parameter
 * the redactor treats as sensitive (`username`, `password`, `token`, `mac`,
 * …), and the two account segments after `/live/`, `/movie/`, `/series/` or
 * `/timeshift/` when a stream follows them. A URL or parameter list nested
 * in a kept parameter or path segment (a proxy's `?url=…`, even encoded
 * twice) is cleaned the same way, and a part that still names a secret (`joe:hunter2@…`, `token=…`) is
 * dropped. A list can then say where a source points without any part of
 * its credentials.
 *
 * Returns null for text that is not an absolute URL, so a caller never
 * renders the unparsed original by mistake.
 */
export function stripUrlCredentials(value: string): string | null {
    return stripUrl(value, 0);
}
