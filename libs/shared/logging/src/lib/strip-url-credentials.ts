import {
    isSensitiveKey,
    looksLikeSearchParams,
    XTREAM_CREDENTIAL_PATH_SEGMENTS,
} from './redact-sensitive-data';

/**
 * Short account keys some playlist URLs use. A log line keeps them for
 * diagnosis; a list on screen has no reason to.
 */
const SHORT_ACCOUNT_KEYS = new Set(['user', 'usr', 'pass', 'pas']);

/** How deep URLs nested in URLs are cleaned; anything deeper is dropped. */
const MAX_NESTING = 4;
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//iu;
const EMBEDDED_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu;
/** `joe:hunter2@origin.test`: an authority's userinfo without a scheme. */
const BARE_USERINFO = /(?:^|[\s/])[^\s/:@]+:[^\s/@]*@[^\s/@]/u;
const KEYED_PAIR = /\b([a-z][a-z0-9_.-]*)\s*[=:]/giu;

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
    if (depth >= MAX_NESTING) {
        return null;
    }
    const trimmed = value.trim();
    if (ABSOLUTE_URL.test(trimmed)) {
        return stripUrl(trimmed, depth + 1);
    }
    if (looksLikeSearchParams(trimmed)) {
        return withoutSensitiveParams(new URLSearchParams(trimmed), depth + 1);
    }
    if (BARE_USERINFO.test(value) || hasSensitivePair(value)) {
        return null;
    }
    return value.replace(
        EMBEDDED_URL,
        (candidate) => stripUrl(candidate, depth + 1) ?? ''
    );
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
    const kept: string[] = [];
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const decoded = decodeSegment(segment);
        const clean = sanitizeNested(decoded, depth);
        if (clean !== null) {
            kept.push(clean === decoded ? segment : encodeURIComponent(clean));
        }
        if (
            XTREAM_CREDENTIAL_PATH_SEGMENTS.has(segment) &&
            index + 2 < segments.length
        ) {
            index += 2;
        }
    }
    url.pathname = kept.join('/');

    const search = withoutSensitiveParams(url.searchParams, depth);
    url.search = search ? `?${search}` : '';

    const fragment = url.hash.slice(1);
    if (looksLikeSearchParams(fragment)) {
        const hash = withoutSensitiveParams(
            new URLSearchParams(fragment),
            depth
        );
        url.hash = hash ? `#${hash}` : '';
    }

    return url.toString();
}

/**
 * A URL safe to show on screen. Where the log redactor replaces secrets with
 * a marker, this drops them: the userinfo, every query or fragment parameter
 * the redactor treats as sensitive (`username`, `password`, `token`, `mac`,
 * …), and the two account segments after `/live/`, `/movie/`, `/series/` or
 * `/timeshift/` in an Xtream stream path. A URL or parameter list nested in
 * a kept parameter or path segment (a proxy's `?url=…`) is cleaned the same
 * way, and a part that still names a secret (`joe:hunter2@…`, `token=…`) is
 * dropped. A list can then say where a source points without any part of
 * its credentials.
 *
 * Returns null for text that is not an absolute URL, so a caller never
 * renders the unparsed original by mistake.
 */
export function stripUrlCredentials(value: string): string | null {
    return stripUrl(value, 0);
}
