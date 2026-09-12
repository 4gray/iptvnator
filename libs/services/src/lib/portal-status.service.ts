import { SourceHealthEvidenceService } from './source-health-evidence.service';
import {
    accountHealth,
    sourceHealthUnknown,
} from '@iptvnator/shared/interfaces';
import { Injectable, inject } from '@angular/core';
import {
    normalizeXtreamServerUrl,
    resolveXtreamPortalExpiration,
    resolveXtreamPortalStatus,
    XtreamPortalStatusResponseLike,
} from '@iptvnator/shared/interfaces';
import { DataService } from './data.service';
import { resetHostConnectivityGuard } from './host-connectivity-reset';

export type PortalStatus =
    'active' | 'inactive' | 'expired' | 'unavailable' | 'checking';

/**
 * Status plus the parsed account expiration from the same round-trip the
 * status check already makes — consumers that care about "expires soon"
 * (dashboard source cards) share the cache instead of issuing their own
 * `get_account_info` calls.
 */
export interface PortalStatusDetails {
    status: PortalStatus;
    /** Unix seconds; null when the portal doesn't report an expiration. */
    expiresAtSeconds: number | null;
}

interface XtreamPortalStatusResponse {
    payload?: XtreamPortalStatusResponseLike;
}

interface PortalStatusCacheEntry {
    details: PortalStatusDetails;
    timestamp: number;
}

interface CheckPortalStatusOptions {
    /**
     * Skip the cache and force a fresh round-trip. Use for explicit user
     * actions like "Test Connection" buttons; default behavior (cache hit
     * within TTL returns immediately) is correct for passive status checks.
     */
    skipCache?: boolean;
}

const PORTAL_STATUS_CACHE_TTL_MS = 30_000;
const XTREAM_STATUS_ACTIONS = [
    'get_account_info',
    null,
    'get_profile',
] as const;

@Injectable({
    providedIn: 'root',
})
export class PortalStatusService {
    private readonly dataService = inject(DataService);
    private readonly healthEvidence = inject(SourceHealthEvidenceService, {
        optional: true,
    });

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
    private readonly inFlight = new Map<string, Promise<PortalStatusDetails>>();

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
        const details = await this.checkPortalStatusDetails(
            serverUrl,
            username,
            password,
            options
        );
        return details.status;
    }

    /**
     * Same check as {@link checkPortalStatus} (shared cache, shared in-flight
     * dedup) but returns the account expiration alongside the status.
     */
    async checkPortalStatusDetails(
        serverUrl: string,
        username: string,
        password: string,
        options?: CheckPortalStatusOptions
    ): Promise<PortalStatusDetails> {
        const connection = this.normalizeConnection(
            serverUrl,
            username,
            password
        );
        if (!connection) {
            return { status: 'unavailable', expiresAtSeconds: null };
        }

        const cacheKey = this.buildCacheKey(
            connection.serverUrl,
            connection.username,
            connection.password
        );

        const cachedAtStart = this.cache.get(cacheKey);
        if (!options?.skipCache) {
            const cached = cachedAtStart;
            if (
                cached &&
                Date.now() - cached.timestamp < PORTAL_STATUS_CACHE_TTL_MS
            ) {
                return cached.details;
            }

            const pending = this.inFlight.get(cacheKey);
            if (pending) {
                return pending;
            }
        } else {
            // Skipping the cache means the user asked to test this portal
            // right now, so the main process must forget any connection
            // failures it recorded for the host and contact it for real.
            await resetHostConnectivityGuard(
                this.dataService,
                connection.serverUrl
            );
        }

        const request = this.fetchPortalStatus(
            connection.serverUrl,
            connection.username,
            connection.password
        )
            .then((details) => {
                if (this.inFlight.get(cacheKey) === request) {
                    this.cache.set(cacheKey, {
                        details,
                        timestamp: Date.now(),
                    });
                } else {
                    // Existing callers also receive the newer explicit evidence.
                    const newer = this.cache.get(cacheKey);
                    return newer &&
                        newer !== cachedAtStart &&
                        Date.now() - newer.timestamp <
                            PORTAL_STATUS_CACHE_TTL_MS
                        ? newer.details
                        : details;
                }
                return details;
            })
            .finally(() => {
                if (this.inFlight.get(cacheKey) === request)
                    this.inFlight.delete(cacheKey);
            });

        this.inFlight.set(cacheKey, request);

        return request;
    }

    /**
     * Synchronous read of the cached status for a credential triple.
     * Returns null if no entry exists or the entry has expired.
     */
    getCachedStatus(
        serverUrl: string,
        username: string,
        password: string
    ): PortalStatus | null {
        const connection = this.normalizeConnection(
            serverUrl,
            username,
            password
        );
        if (!connection) {
            return null;
        }

        const cached = this.cache.get(
            this.buildCacheKey(
                connection.serverUrl,
                connection.username,
                connection.password
            )
        );
        if (!cached) {
            return null;
        }
        if (Date.now() - cached.timestamp >= PORTAL_STATUS_CACHE_TTL_MS) {
            return null;
        }
        return cached.details.status;
    }

    /** Publish explicit probe evidence without another network request. */
    rememberXtreamResponse(
        serverUrl: string,
        username: string,
        password: string,
        response: XtreamPortalStatusResponseLike | undefined
    ): void {
        const connection = this.normalizeConnection(
            serverUrl,
            username,
            password
        );
        if (!connection) return;
        const key = this.buildCacheKey(
            connection.serverUrl,
            connection.username,
            connection.password
        );
        const info = response?.user_info;
        if (info) {
            const result = accountHealth(
                info.status,
                resolveXtreamPortalExpiration(response) ?? undefined,
                info.auth === true || info.auth === 1 || info.auth === '1'
            );
            this.healthEvidence?.results.next({
                playlist: { _id: '', ...connection },
                result:
                    (info.auth === false ||
                        info.auth === 0 ||
                        info.auth === '0') &&
                    !result.confirmedInactive
                        ? { ...sourceHealthUnknown('auth'), state: 'inactive' }
                        : result,
            });
        }
        // A passive check started before this evidence cannot overwrite it.
        this.inFlight.delete(key);
        this.cache.set(key, {
            details: {
                status: resolveXtreamPortalStatus(response),
                expiresAtSeconds: resolveXtreamPortalExpiration(response),
            },
            timestamp: Date.now(),
        });
    }

    /** Clear the entire cache. Useful for log-out or debug flows. */
    clearStatusCache(): void {
        this.cache.clear();
        this.inFlight.clear();
    }

    private buildCacheKey(
        serverUrl: string,
        username: string,
        password: string
    ): string {
        return `${serverUrl}|${username}|${password}`;
    }

    private normalizeConnection(
        serverUrl: string,
        username: string,
        password: string
    ): {
        password: string;
        serverUrl: string;
        username: string;
    } | null {
        try {
            const normalizedUsername = username.trim();
            const normalizedPassword = password.trim();
            if (!normalizedUsername || !normalizedPassword) {
                return null;
            }

            return {
                serverUrl: normalizeXtreamServerUrl(serverUrl),
                username: normalizedUsername,
                password: normalizedPassword,
            };
        } catch {
            return null;
        }
    }

    private async fetchPortalStatus(
        serverUrl: string,
        username: string,
        password: string
    ): Promise<PortalStatusDetails> {
        for (const action of XTREAM_STATUS_ACTIONS) {
            try {
                const response =
                    await this.dataService.sendIpcEvent<XtreamPortalStatusResponse>(
                        'XTREAM_REQUEST',
                        {
                            url: serverUrl,
                            params: {
                                ...(action ? { action } : {}),
                                password,
                                username,
                            },
                            suppressErrorLog: true,
                        }
                    );
                const status = resolveXtreamPortalStatus(response?.payload);
                if (status !== 'unavailable') {
                    return {
                        status,
                        expiresAtSeconds: resolveXtreamPortalExpiration(
                            response?.payload
                        ),
                    };
                }
            } catch {
                // Try the next Xtream account-info action variant.
            }
        }

        return { status: 'unavailable', expiresAtSeconds: null };
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
