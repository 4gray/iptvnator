import { normalizeStalkerPlaybackCommand } from './stalker-playback-command.utils';

/**
 * The two catalog flags that decide whether a row needs a temporary link.
 *
 * Reference behaviour (portal `player.js`, mirrored by Kodi's pvr.stalker):
 * a client calls `create_link` only when the row asks for it — either because
 * the portal proxies the stream through a per-session temporary URL
 * (`use_http_tmp_link`) or because it picks a storage server per request
 * (`use_load_balancing`). Every other row plays the static `cmd` that
 * `get_all_channels` / `get_ordered_list` already returned.
 *
 * Portals send these as `'1'`/`'0'` strings, `1`/`0` numbers or booleans, so
 * the values arrive untyped.
 */
export interface StalkerLinkFlagSource {
    use_http_tmp_link?: unknown;
    use_load_balancing?: unknown;
}

/**
 * Hosts that can only mean "the portal itself". A `cmd` such as
 * `ffrt3 http://localhost/ch/1234_` is an instruction to the portal, never an
 * address the set-top box could open, so it always needs resolving.
 */
const PORTAL_LOCAL_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
]);

/** Truthiness for portal flags, which arrive as strings, numbers or booleans. */
export function isStalkerPortalFlagEnabled(value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) && value !== 0;
    }

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return normalized !== '0' && normalized !== 'false';
}

/**
 * Whether the row explicitly asks the client to mint a temporary link.
 */
export function requiresStalkerTemporaryLink(
    source: StalkerLinkFlagSource | null | undefined
): boolean {
    return (
        isStalkerPortalFlagEnabled(source?.use_http_tmp_link) ||
        isStalkerPortalFlagEnabled(source?.use_load_balancing)
    );
}

/**
 * The playable URL for a row that does NOT need `create_link`, or `null` when
 * the portal has to resolve it.
 *
 * `null` is returned for every shape a client cannot resolve on its own, which
 * is deliberately wider than the flag check alone — the flags are the rule,
 * these guards only ever push a row back onto today's `create_link` path and
 * so cannot regress a portal that works now:
 *
 * - no row at all — a caller that cannot show the flags gets no verdict, which
 *   is not the same as a row that carries none (a portal too old to send them
 *   is genuinely announcing "no temporary link");
 * - either flag set — the portal asked for a temporary link;
 * - a relative (`/media/file_12.mpg`) or query-only (`?token=…`) command —
 *   only `create_link` turns those into an address, and the VOD `has_files`
 *   rewrite produces exactly the first shape;
 * - a non-HTTP scheme (`ffrt4://ch/live/…`) — a portal-internal pseudo-URL;
 * - a loopback host — a portal-side placeholder (see
 *   {@link PORTAL_LOCAL_HOSTNAMES}).
 */
export function resolveStalkerStaticPlaybackUrl(
    source: StalkerLinkFlagSource | null | undefined,
    cmd: string
): string | null {
    if (!source || requiresStalkerTemporaryLink(source)) {
        return null;
    }

    const url = normalizeStalkerPlaybackCommand(cmd);
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return null;
    }

    try {
        const hostname = new URL(url).hostname.toLowerCase();
        if (PORTAL_LOCAL_HOSTNAMES.has(hostname)) {
            return null;
        }
    } catch {
        return null;
    }

    return url;
}
