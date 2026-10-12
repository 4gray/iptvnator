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

function isDisplaySensitiveKey(key: string): boolean {
    return SHORT_ACCOUNT_KEYS.has(key.toLowerCase()) || isSensitiveKey(key);
}

function withoutSensitiveParams(params: URLSearchParams): string {
    const kept = new URLSearchParams();
    params.forEach((value, key) => {
        if (!isDisplaySensitiveKey(key)) {
            kept.append(key, value);
        }
    });
    return kept.toString();
}

/**
 * A URL safe to show on screen. Where the log redactor replaces secrets with
 * a marker, this drops them: the userinfo, every query or fragment parameter
 * the redactor treats as sensitive (`username`, `password`, `token`, `mac`,
 * …), and the two account segments after `/live/`, `/movie/`, `/series/` or
 * `/timeshift/` in an Xtream stream path. A list can then say where a source
 * points without any part of its credentials.
 *
 * Returns null for text that is not an absolute URL, so a caller never
 * renders the unparsed original by mistake.
 */
export function stripUrlCredentials(value: string): string | null {
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
        kept.push(segments[index]);
        if (
            XTREAM_CREDENTIAL_PATH_SEGMENTS.has(segments[index]) &&
            index + 2 < segments.length
        ) {
            index += 2;
        }
    }
    url.pathname = kept.join('/');

    const search = withoutSensitiveParams(url.searchParams);
    url.search = search ? `?${search}` : '';

    const fragment = url.hash.slice(1);
    if (looksLikeSearchParams(fragment)) {
        const hash = withoutSensitiveParams(new URLSearchParams(fragment));
        url.hash = hash ? `#${hash}` : '';
    }

    return url.toString();
}
