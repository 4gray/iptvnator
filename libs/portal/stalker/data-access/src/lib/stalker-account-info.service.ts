import { inject, Injectable } from '@angular/core';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from './stalker-session.service';
import {
    executeStalkerRequest,
    toStalkerSessionPlaylist,
} from './stores/utils/stalker-request.utils';

/**
 * Normalized account facts for a Stalker portal. Shape matches the cached
 * `Playlist.stalkerAccountInfo` snapshot taken at import so both sources
 * render through the same view model; `mac`/`phone` only exist on the
 * fresh path.
 */
export interface StalkerAccountSnapshot {
    login?: string;
    /** Unix timestamp in seconds. */
    expireDate?: number;
    tariffPlanName?: string;
    status?: number;
    mac?: string;
    phone?: string;
}

interface StalkerMainInfoFields {
    mac?: string;
    phone?: string;
    login?: string;
    fname?: string;
    status?: number | string;
    tariff_plan?: string;
    tariff_plan_name?: string;
    end_date?: number | string;
    expire_date?: number | string;
    expire_billing_date?: number | string;
}

interface StalkerMainInfoResponse {
    js?:
        | (StalkerMainInfoFields & {
              /**
               * Ministra-style portals nest the account block —
               * `fetchStalkerExpireDate()` in stalker-player-request.utils
               * reads this exact envelope. Other panels answer flat.
               */
              account_info?: StalkerMainInfoFields | null;
          })
        | null;
}

/**
 * Fetches fresh account information from a Stalker portal.
 *
 * Full `/stalker_portal/` installations expose the canonical account block
 * on `get_profile`, so those re-run the same handshake+profile pair the
 * import dialog used. Legacy `portal.php` panels have no profile call for
 * MAC-only accounts; for them the best available source is
 * `account_info/get_main_info`, whose field set varies wildly between
 * panels — everything is mapped best-effort and absent fields stay absent.
 */
@Injectable({ providedIn: 'root' })
export class StalkerAccountInfoService {
    private readonly dataService = inject(DataService);
    private readonly stalkerSession = inject(StalkerSessionService);

    async fetchAccountInfo(
        playlist: PlaylistMeta
    ): Promise<StalkerAccountSnapshot | null> {
        if (!playlist.portalUrl || !playlist.macAddress) {
            return null;
        }

        if (isFullStalkerPortalPlaylist(playlist)) {
            return this.fetchViaProfile(playlist);
        }

        return this.fetchViaMainInfo(playlist);
    }

    private async fetchViaProfile(
        playlist: PlaylistMeta
    ): Promise<StalkerAccountSnapshot | null> {
        // Goes through the session service rather than calling
        // authenticate() directly: it serializes with any in-flight
        // ensureToken() and republishes the resulting token, so the
        // dialog cannot strand an active portal session on a token its
        // own handshake invalidated.
        const accountInfo = await this.stalkerSession.refreshAccountProfile(
            toStalkerSessionPlaylist(playlist)
        );

        if (!accountInfo) {
            return null;
        }

        return normalizeSnapshot({
            login: accountInfo.login,
            expireDate: parseStalkerDate(accountInfo.expire_date),
            tariffPlanName: accountInfo.tariff_plan_name,
            status: parseStalkerNumber(accountInfo.status),
        });
    }

    private async fetchViaMainInfo(
        playlist: PlaylistMeta
    ): Promise<StalkerAccountSnapshot | null> {
        const response = await executeStalkerRequest<StalkerMainInfoResponse>(
            {
                dataService: this.dataService,
                stalkerSession: this.stalkerSession,
            },
            playlist,
            {
                type: 'account_info',
                action: 'get_main_info',
                JsHttpRequest: '1-xml',
            }
        );

        const flat = response?.js;
        if (!flat || typeof flat !== 'object') {
            return null;
        }

        // Nested envelope wins field-by-field; flat top-level values remain
        // as aliases for panels that answer without the account_info block.
        const nested =
            flat.account_info && typeof flat.account_info === 'object'
                ? flat.account_info
                : {};
        const info: StalkerMainInfoFields = { ...flat, ...nested };

        return normalizeSnapshot({
            login: info.login || info.fname || undefined,
            expireDate:
                parseStalkerDate(info.expire_date) ??
                parseStalkerDate(info.end_date) ??
                parseStalkerDate(info.expire_billing_date),
            tariffPlanName:
                info.tariff_plan_name || info.tariff_plan || undefined,
            status: parseStalkerNumber(info.status),
            mac: info.mac || undefined,
            phone: info.phone || undefined,
        });
    }
}

/**
 * Whether a playlist should use the full `/stalker_portal/` flow.
 *
 * The persisted flag is authoritative when present, but a playlist
 * restored from an older backup can carry `undefined` after the one-shot
 * metadata migration has already run — fall back to the same URL rule
 * that migration uses (`withExplicitLegacyStalkerPortalFlag` in
 * PlaylistsService) rather than mislabelling it as a legacy panel.
 */
export function isFullStalkerPortalPlaylist(playlist: PlaylistMeta): boolean {
    if (playlist.isFullStalkerPortal !== undefined) {
        return Boolean(playlist.isFullStalkerPortal);
    }

    const portalUrl = playlist.portalUrl ?? playlist.url ?? '';
    return (
        portalUrl.includes('/stalker_portal') ||
        portalUrl.includes('/server/load.php')
    );
}

function normalizeSnapshot(
    snapshot: StalkerAccountSnapshot
): StalkerAccountSnapshot | null {
    const hasAnyFact = Object.values(snapshot).some(
        (value) => value !== undefined
    );
    return hasAnyFact ? snapshot : null;
}

/**
 * Normalizes the `Playlist.stalkerAccountInfo` snapshot persisted at import
 * time. The import path stores the portal's `expire_date`/`status` verbatim,
 * so despite the declared number types the runtime values can be date
 * strings or millisecond timestamps — run them through the same parsers the
 * fresh path uses before the dialog renders them.
 */
export function normalizeStoredStalkerAccountInfo(
    cached:
        | {
              login?: string;
              expireDate?: number | string;
              tariffPlanName?: string;
              status?: number | string;
          }
        | null
        | undefined
): StalkerAccountSnapshot | null {
    if (!cached || typeof cached !== 'object') {
        return null;
    }

    return normalizeSnapshot({
        login: cached.login || undefined,
        expireDate: parseStalkerDate(cached.expireDate),
        tariffPlanName: cached.tariffPlanName || undefined,
        status: parseStalkerNumber(cached.status),
    });
}

/**
 * Portals report dates as unix seconds, unix milliseconds, or date strings
 * ("2026-10-01", "0000-00-00"). Returns unix seconds, or undefined when the
 * value cannot be read as a real future-or-past date.
 */
export function parseStalkerDate(
    value: number | string | null | undefined
): number | undefined {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }

    // Signed numerics included: portals encode "unlimited" as "-1"/"0",
    // and Date.parse('-1') would otherwise read as January 1, 2001.
    if (typeof value === 'number' || /^-?\d+$/.test(String(value).trim())) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return undefined;
        }
        // Values past the year 3000 in seconds are actually milliseconds.
        return numeric > 32_503_680_000
            ? Math.round(numeric / 1000)
            : Math.round(numeric);
    }

    const text = String(value).trim();

    // A bare `YYYY-MM-DD` is a calendar date, but Date.parse reads it as
    // UTC midnight — rendered locally that shows the previous day west of
    // UTC and moves the days-left boundary. Build it in local time instead.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) {
        const year = Number(dateOnly[1]);
        const month = Number(dateOnly[2]);
        const day = Number(dateOnly[3]);
        const local = new Date(year, month - 1, day);
        // Round-trip check: the multi-argument constructor normalizes
        // out-of-range components ('2026-00-00' → Nov 30, 2025), which
        // would fabricate an expiry from a placeholder.
        if (
            local.getFullYear() !== year ||
            local.getMonth() !== month - 1 ||
            local.getDate() !== day
        ) {
            return undefined;
        }
        const timestamp = local.getTime();
        return Number.isFinite(timestamp) && timestamp > 0
            ? Math.round(timestamp / 1000)
            : undefined;
    }

    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return Math.round(parsed / 1000);
}

function parseStalkerNumber(
    value: number | string | null | undefined
): number | undefined {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
