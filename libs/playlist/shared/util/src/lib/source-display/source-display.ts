import {
    PlaylistMeta,
    playlistDisplayLabel,
    playlistNameHasCredentials,
    resolvePlaylistSourceKind,
} from '@iptvnator/shared/interfaces';
import { decodeFully, findXtreamAccount } from '@iptvnator/shared/logging';
import {
    isDisplaySensitiveKey,
    stripUrlCredentials,
    unwrapNestedValue,
} from './strip-url-credentials';

export type SourceDisplayFields = Partial<
    Pick<
        PlaylistMeta,
        | 'title'
        | 'filename'
        | 'url'
        | 'serverUrl'
        | 'portalUrl'
        | 'macAddress'
        | 'username'
        | 'password'
    >
>;

/** The account name stays on screen by design; every other secret goes. */
const SHOWN_ACCOUNT_KEYS = new Set(['username', 'login', 'user', 'usr']);
/**
 * Shorter secrets match ordinary words inside a text, so they count only
 * as the whole text: a name that is just a two-letter password is hidden.
 */
const MIN_SECRET_LENGTH = 3;
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
/** Six hex pairs, as a STB MAC is written, wherever the secret came from. */
const MAC_ADDRESS = /^[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}$/i;

function parseUrl(value: string | undefined): URL | null {
    if (!value) {
        return null;
    }
    try {
        return new URL(value.trim());
    } catch {
        return null;
    }
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** The portal, server or playlist URL a source is loaded from. */
export function sourceEndpoint(
    playlist: Pick<
        SourceDisplayFields,
        'macAddress' | 'serverUrl' | 'portalUrl' | 'url'
    >
): string | undefined {
    if (playlist.macAddress) {
        return playlist.portalUrl || playlist.url;
    }
    return playlist.serverUrl || playlist.url;
}

/** Host and non-default port of the endpoint; null for a local file. */
export function sourceHost(
    playlist: Pick<
        SourceDisplayFields,
        'macAddress' | 'serverUrl' | 'portalUrl' | 'url'
    >
): string | null {
    return parseUrl(sourceEndpoint(playlist))?.host || null;
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/** How deep URLs nested in the source URL are searched for secrets. */
const MAX_SECRET_NESTING = 4;

/**
 * The secrets a URL carries: its userinfo password, the password of an
 * Xtream stream path, every sensitive query or fragment parameter (the
 * source's own account name excepted), and the same again in any URL or
 * parameter list nested in a parameter or path segment, whose account names
 * count as secrets too.
 */
function collectUrlSecrets(
    url: URL,
    secrets: (string | undefined)[],
    depth: number
): void {
    if (depth >= MAX_SECRET_NESTING) {
        return;
    }
    secrets.push(safeDecode(url.password));
    if (depth > 0) {
        secrets.push(safeDecode(url.username));
    }
    const visitNested = (raw: string): void => {
        const value = unwrapNestedValue(raw);
        if (value === null) {
            return;
        }
        // Only real JSON: `[password]=…` starts like it but is a parameter
        // list, read below.
        const json = /^\s*[{[]/.test(value) ? parseJson(value) : null;
        if (json !== null && typeof json === 'object') {
            visitJson(json, 0);
            return;
        }
        const nested = ABSOLUTE_URL.test(value.trim()) ? parseUrl(value) : null;
        if (nested) {
            collectUrlSecrets(nested, secrets, depth + 1);
        } else if (value.includes('=')) {
            visit(new URLSearchParams(value));
        }
    };
    // A JSON config in a parameter: values under sensitive keys are
    // secrets, and any other string may be a URL or a parameter list.
    const visitJson = (value: unknown, level: number): void => {
        if (level >= MAX_SECRET_NESTING) {
            return;
        }
        if (typeof value === 'string') {
            visitNested(value);
        } else if (Array.isArray(value)) {
            value.forEach((item) => visitJson(item, level + 1));
        } else if (value && typeof value === 'object') {
            for (const [key, inner] of Object.entries(value)) {
                const scalar =
                    typeof inner === 'string' || typeof inner === 'number';
                if (scalar && isDisplaySensitiveKey(key)) {
                    secrets.push(String(inner));
                } else {
                    visitJson(inner, level + 1);
                }
            }
        }
    };
    const visit = (params: URLSearchParams): void =>
        params.forEach((value, key) => {
            const normalized = decodeFully(key)
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
            if (isDisplaySensitiveKey(key)) {
                if (depth > 0 || !SHOWN_ACCOUNT_KEYS.has(normalized)) {
                    secrets.push(value);
                }
                return;
            }
            visitNested(value);
        });
    // An Xtream stream path carries the account:
    // `/live/<user>/<password>/<stream>`.
    const segments = url.pathname.split('/');
    const { accounts } = findXtreamAccount(segments, { streamFollows: true });
    for (const [user, password] of accounts) {
        secrets.push(password);
        if (depth > 0) {
            secrets.push(user);
        }
    }
    // A proxy may carry a whole URL in one segment.
    segments.map(safeDecode).forEach(visitNested);
    visit(url.searchParams);
    // A fragment may hold a parameter list or a whole URL.
    visitNested(url.hash.slice(1));
}

/**
 * Values that must never be on screen for this source: the password, the
 * MAC address, and every secret its URL carries (`collectUrlSecrets`), in
 * both decoded and encoded form.
 */
function sourceSecrets(playlist: SourceDisplayFields): string[] {
    const secrets = [playlist.password, playlist.macAddress];
    const url = parseUrl(sourceEndpoint(playlist));
    if (url) {
        collectUrlSecrets(url, secrets, 0);
    }
    const forms: string[] = [];
    for (const secret of secrets) {
        if (secret) {
            // A value encoded more than once reads as itself in a name.
            forms.push(secret, encodeURIComponent(secret), decodeFully(secret));
        }
    }
    return forms;
}

/**
 * Whether one of the texts shows the secret: as the whole text, or inside
 * it when the secret is long enough. Each form on its own: `%2542` decodes
 * to `B`, which may only hide a text that is nothing but `B`.
 */
function shows(texts: readonly string[], secret: string): boolean {
    return texts.some(
        (text) =>
            text === secret ||
            (secret.length >= MIN_SECRET_LENGTH && text.includes(secret))
    );
}

/**
 * Whether the text shows any of the source's secrets, read as written and
 * fully decoded (so `%3a` escapes count as `:`). A password is compared in
 * its own case: `Stress` in a name is not the password `stress`. A MAC is
 * the same address in either letter case, so it is compared lower-cased:
 * the source's own, and any MAC-shaped secret its URL carries (`?mac=…`,
 * nested ones included).
 */
export function containsSourceSecret(
    text: string,
    playlist: SourceDisplayFields
): boolean {
    const texts = [text, decodeFully(text)].map((form) => form.trim());
    const lowerTexts = texts.map((form) => form.toLowerCase());
    const ownMac = playlist.macAddress?.toLowerCase();
    return sourceSecrets(playlist).some((secret) => {
        const plain = decodeFully(secret).toLowerCase();
        const isMac = plain === ownMac || MAC_ADDRESS.test(plain);
        return isMac
            ? shows(lowerTexts, secret.toLowerCase())
            : shows(texts, secret);
    });
}

/**
 * A name an import made from the URL rather than one the user typed: the
 * URL itself, or the end of a URL with a query or fragment, such as
 * `get.php?username=…&password=…` or `list.m3u#api_key=…`.
 */
function isUrlDerivedName(name: string, url: string | undefined): boolean {
    if (ABSOLUTE_URL.test(name)) {
        return true;
    }
    return !!url && /[?#]/.test(name) && url.trim().endsWith(name);
}

/**
 * The name a source list shows. A name the user chose stays; an empty name,
 * a URL or a URL-derived name becomes the host, and any name that carries a
 * credential collapses to the host as well. Null when there is nothing safe
 * to show; the caller renders its "untitled" label.
 */
export function sourceDisplayName(
    playlist: SourceDisplayFields
): string | null {
    const raw = (playlist.title || playlist.filename || '').trim();
    const host = sourceHost(playlist);
    if (!raw) {
        return host;
    }
    if (
        isUrlDerivedName(raw, playlist.url) ||
        playlistNameHasCredentials(raw)
    ) {
        return host ?? (playlistDisplayLabel(raw) || null);
    }
    return containsSourceSecret(raw, playlist) ? host : raw;
}

/** The name a list shows and sorts a source by; empty when it has none. */
export function sourceSortName(playlist: SourceDisplayFields): string {
    return sourceDisplayName(playlist) ?? '';
}

/** `origin/…/last` once a path has more than two segments. */
function compactPath(pathname: string): string {
    const segments = pathname.split('/').filter(Boolean);
    return segments.length > 2
        ? `/…/${segments[segments.length - 1]}`
        : pathname;
}

/**
 * The location a source list shows beside the name, without credentials:
 * `scheme://host:port · username` for Xtream, the portal URL for Stalker,
 * the playlist URL with a shortened path for M3U, and null for a local file.
 */
export function sourceDisplayUrl(playlist: SourceDisplayFields): string | null {
    const kind = resolvePlaylistSourceKind(playlist);
    if (kind === 'xtream') {
        const server = parseUrl(playlist.serverUrl);
        if (!server) {
            return null;
        }
        const base = `${server.protocol}//${server.host}`;
        // An account name that is, or holds, the password stays off screen.
        const user = playlist.username;
        return user && !containsSourceSecret(user, playlist)
            ? `${base} · ${user}`
            : base;
    }

    const stripped = parseUrl(
        stripUrlCredentials(sourceEndpoint(playlist) ?? '') ?? undefined
    );
    if (!stripped) {
        return null;
    }
    const origin = `${stripped.protocol}//${stripped.host}`;
    const shown = `${origin}${compactPath(stripped.pathname)}${stripped.search}${stripped.hash}`;
    return containsSourceSecret(shown, playlist) ? origin : shown;
}

/**
 * The full address "Copy URL" puts on the clipboard; credentials included,
 * since that is what the user asked for. Null for a local file.
 */
export function sourceCopyUrl(
    playlist: Pick<
        SourceDisplayFields,
        'macAddress' | 'serverUrl' | 'portalUrl' | 'url'
    >
): string | null {
    return sourceEndpoint(playlist)?.trim() || null;
}
