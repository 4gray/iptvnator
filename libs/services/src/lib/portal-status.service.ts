import { Injectable, inject } from '@angular/core';
import { DataService } from './data.service';
import { SourceVpnRequestContext } from 'shared-interfaces';

export type PortalStatus =
    | 'active'
    | 'inactive'
    | 'expired'
    | 'unavailable'
    | 'checking';

interface XtreamPortalStatusResponse {
    payload?: {
        user_info?: {
            auth?: number | string | boolean;
            status?: string;
            exp_date?: string;
        };
    };
}

interface PortalStatusCacheEntry {
    status: PortalStatus;
    timestamp: number;
}

interface CheckPortalStatusOptions {
    /**
     * Skip the cache and force a fresh round-trip. Use for explicit user
     * actions like "Test Connection" buttons; default behavior (cache hit
     * within TTL returns immediately) is correct for passive status checks.
     */
    skipCache?: boolean;
    sourceVpn?: SourceVpnRequestContext;
}

const PORTAL_STATUS_CACHE_TTL_MS = 30_000;

@Injectable({
    providedIn: 'root',
})
export class PortalStatusService {
    private readonly dataService = inject(DataService);

    /**
     * Process-lifetime cache shared across all consumers (playlist switcher,
     * recent playlists item, etc.). Same credential triple = same cache
     * entry, so opening the homepage and then the switcher within 30 s
     * skips redundant IPC + HTTPS round-trips.
     */
    private readonly cache = new Map<string, PortalStatusCacheEntry>();

    /**
     * Dedup in-flight requests so two near-simultaneous callers (homepage
     * playlist-item + switcher menu open) share a single network round-trip
     * instead of racing each other.
     */
    private readonly inFlight = new Map<string, Promise<PortalStatus>>();

    /**
     * Checks the status of an Xtream Code portal
     *
     * @param serverUrl The base URL of the server
     * @param username The username for authentication
     * @param password The password for authentication
     * @param options Pass `{ skipCache: true }` for user-initiated checks
     *                that must bypass the cache (e.g. "Test Connection")
     * @returns A promise that resolves to the portal status
     */
    async checkPortalStatus(
        serverUrl: string,
        username: string,
        password: string,
        options?: CheckPortalStatusOptions
    ): Promise<PortalStatus> {
        const cacheKey = this.buildCacheKey(
            serverUrl,
            username,
            password,
            options?.sourceVpn
        );

        if (!options?.skipCache) {
            const cached = this.cache.get(cacheKey);
            if (
                cached &&
                Date.now() - cached.timestamp < PORTAL_STATUS_CACHE_TTL_MS
            ) {
                return cached.status;
            }

            const pending = this.inFlight.get(cacheKey);
            if (pending) {
                return pending;
            }
        }

        const request = this.fetchPortalStatus(
            serverUrl,
            username,
            password,
            options?.sourceVpn
        )
            .then((status) => {
                this.cache.set(cacheKey, {
                    status,
                    timestamp: Date.now(),
                });
                return status;
            })
            .finally(() => {
                this.inFlight.delete(cacheKey);
            });

        if (!options?.skipCache) {
            this.inFlight.set(cacheKey, request);
        }

        return request;
    }

    /**
     * Synchronous read of the cached status for a credential triple.
     * Returns null if no entry exists or the entry has expired.
     */
    getCachedStatus(
        serverUrl: string,
        username: string,
        password: string,
        sourceVpn?: SourceVpnRequestContext
    ): PortalStatus | null {
        const cached = this.cache.get(
            this.buildCacheKey(serverUrl, username, password, sourceVpn)
        );
        if (!cached) {
            return null;
        }
        if (Date.now() - cached.timestamp >= PORTAL_STATUS_CACHE_TTL_MS) {
            return null;
        }
        return cached.status;
    }

    /** Clear the entire cache. Useful for log-out or debug flows. */
    clearStatusCache(): void {
        this.cache.clear();
    }

    private buildCacheKey(
        serverUrl: string,
        username: string,
        password: string,
        sourceVpn?: SourceVpnRequestContext
    ): string {
        return [
            serverUrl,
            username,
            password,
            sourceVpn?.provider ?? '',
            sourceVpn?.location ?? '',
        ].join('|');
    }

    private async fetchPortalStatus(
        serverUrl: string,
        username: string,
        password: string,
        sourceVpn?: SourceVpnRequestContext
    ): Promise<PortalStatus> {
        try {
            let normalizedUrl = serverUrl;
            if (serverUrl && !serverUrl.endsWith('/')) {
                normalizedUrl = serverUrl;
            }

            const response =
                await this.dataService.sendIpcEvent<XtreamPortalStatusResponse>(
                    'XTREAM_REQUEST',
                    {
                        url: normalizedUrl,
                        params: {
                            password,
                            username,
                            action: 'get_account_info',
                        },
                        sourceVpn,
                        suppressErrorLog: true,
                    }
            );
            const payload = response?.payload;
            const userInfo = payload?.user_info;
            const status = userInfo?.status?.trim().toLowerCase();
            const auth = userInfo?.auth;
            const isAuthenticated =
                auth === true ||
                auth === 1 ||
                auth === '1' ||
                auth === 'true';

            if (!status && !isAuthenticated) {
                return 'unavailable';
            }

            if (!status || status === 'active') {
                const rawExpDate = userInfo?.exp_date;
                if (!rawExpDate || rawExpDate === '0') {
                    return 'active';
                }

                const expTimestamp = parseInt(rawExpDate, 10);
                if (!Number.isFinite(expTimestamp) || expTimestamp <= 0) {
                    return 'active';
                }

                const expDate = new Date(expTimestamp * 1000);
                return expDate < new Date() ? 'expired' : 'active';
            } else {
                return 'inactive';
            }
        } catch (error) {
            return 'unavailable';
        }
    }

    /**
     * Gets a user-friendly message based on the portal status
     *
     * @param status The portal status
     * @returns A message describing the status
     */
    getStatusMessage(status: PortalStatus | null): string {
        switch (status) {
            case 'active':
                return 'Connection successful! Portal is active.';
            case 'inactive':
                return 'Portal is inactive.';
            case 'expired':
                return 'Portal subscription has expired.';
            case 'unavailable':
                return 'Could not connect to the portal.';
            case 'checking':
                return 'Checking portal status…';
            default:
                return '';
        }
    }

    /**
     * Gets a CSS class name based on the portal status
     *
     * @param status The portal status
     * @returns A CSS class name
     */
    getStatusClass(status: PortalStatus | null): string {
        return status ? `status-${status}` : '';
    }

    /**
     * Gets an icon name based on the portal status
     *
     * @param status The portal status
     * @returns A material icon name
     */
    getStatusIcon(status: PortalStatus | null): string {
        switch (status) {
            case 'active':
                return 'check_circle';
            case 'inactive':
                return 'cancel';
            case 'expired':
                return 'warning';
            case 'checking':
                return 'sync';
            case 'unavailable':
            default:
                return 'error';
        }
    }
}
