/**
 * Single source of truth for the "full Stalker portal" decision.
 *
 * A full portal is one that requires the handshake + Bearer-token auth
 * lifecycle (canonical Stalker/Ministra middleware); a simple portal is a
 * reseller-style `portal.php` panel that answers without any auth. The
 * persisted `Playlist.isFullStalkerPortal` flag is authoritative — since
 * endpoint discovery it records OBSERVED behavior, not a URL guess. The URL
 * shape is only a fallback for legacy rows that predate the flag.
 *
 * History: three predicates used to coexist (import checked
 * `/stalker_portal`, runtime checked `/stalker_portal/` OR
 * `/server/load.php`, the legacy-repair migration checked a third variant)
 * and their drift misclassified canonical `…/server/load.php` portals as
 * token-free at import (#850, #686, #755). Every consumer must go through
 * these helpers so the rule cannot fork again.
 */

/**
 * URL shapes that identify a canonical (full) Stalker portal endpoint.
 * Union of the historical import/runtime/migration variants: matches
 * `/stalker_portal` with or without a trailing slash and the root-level
 * `/server/load.php` used by Ministra installations.
 */
export function isFullStalkerPortalUrl(url: string): boolean {
    return url.includes('/stalker_portal') || url.includes('/server/load.php');
}

/**
 * Whether a playlist should use the full-portal auth lifecycle
 * (handshake, Bearer token, watchdog).
 *
 * The persisted flag wins when present; rows restored from older backups can
 * carry `undefined` even after the one-shot metadata migration ran, so those
 * fall back to the URL rule instead of being mislabelled as legacy panels.
 */
export function isFullStalkerPortalPlaylist(playlist: {
    isFullStalkerPortal?: boolean;
    portalUrl?: string;
    url?: string;
}): boolean {
    if (playlist.isFullStalkerPortal !== undefined) {
        return Boolean(playlist.isFullStalkerPortal);
    }

    return isFullStalkerPortalUrl(playlist.portalUrl ?? playlist.url ?? '');
}
