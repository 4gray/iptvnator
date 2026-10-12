import { isSensitiveKey, stripUrlCredentials } from '@iptvnator/shared/logging';
import {
    PlaylistMeta,
    playlistDisplayLabel,
    playlistNameHasCredentials,
    resolvePlaylistSourceKind,
} from '@iptvnator/shared/interfaces';

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
const SHOWN_ACCOUNT_KEYS = new Set(['username', 'login']);
/** Shorter values match ordinary words, not secrets. */
const MIN_SECRET_LENGTH = 3;

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

/**
 * Values that must never be on screen for this source: the password, the
 * MAC address, and every sensitive parameter of its URL except the account
 * name, in both decoded and encoded form.
 */
function sourceSecrets(playlist: SourceDisplayFields): string[] {
    const secrets = [playlist.password, playlist.macAddress];
    const url = parseUrl(sourceEndpoint(playlist));
    if (url) {
        secrets.push(safeDecode(url.password));
        url.searchParams.forEach((value, key) => {
            const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (isSensitiveKey(key) && !SHOWN_ACCOUNT_KEYS.has(normalized)) {
                secrets.push(value);
            }
        });
    }
    const shown: string[] = [];
    for (const secret of secrets) {
        if (secret && secret.length >= MIN_SECRET_LENGTH) {
            shown.push(secret, encodeURIComponent(secret));
        }
    }
    return shown;
}

export function containsSourceSecret(
    text: string,
    playlist: SourceDisplayFields
): boolean {
    return sourceSecrets(playlist).some((secret) => text.includes(secret));
}

/**
 * A name an import made from the URL rather than one the user typed: the
 * URL itself, or the last path segment of a URL with a query, such as
 * `get.php?username=…&password=…`.
 */
function isUrlDerivedName(name: string, url: string | undefined): boolean {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(name)) {
        return true;
    }
    return !!url && name.includes('?') && url.trim().endsWith(name);
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
        return playlist.username ? `${base} · ${playlist.username}` : base;
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
