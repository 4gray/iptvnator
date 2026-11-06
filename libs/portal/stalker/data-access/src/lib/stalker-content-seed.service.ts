import { inject, Injectable, Injector, type Provider } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    DataService,
    PlaylistsService,
    PORTAL_CONTENT_SEEDERS,
    SettingsStore,
    type PortalContentSeeder,
} from '@iptvnator/services';
import {
    shouldImportLive,
    shouldImportVod,
    StalkerPortalActions,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import { StalkerContentTypes } from './stalker-content-types';
import { StalkerItvCacheService } from './stalker-itv-cache.service';
import { StalkerPortalDiscoveryService } from './stalker-portal-discovery.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerSessionService } from './stalker-session.service';
import { getStalkerPortalIdentityFromPlaylist } from './stalker-identity.utils';
import { stalkerSessionFingerprint } from './stalker-session-store';
import { executeStalkerRequest, type StalkerRequestDeps } from './stores/utils';
import { STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS } from './stalker-watchdog.controller';

/** One page of `get_ordered_list`, the same call the workspace opens with. */
interface StalkerSeedPageResponse {
    js?: {
        data?: unknown;
        total_items?: number | string;
    };
}

interface StalkerSeedCategoriesResponse {
    js?: unknown;
}

/**
 * Validates a freshly imported Stalker source and starts warming its live
 * catalog. Bulk import hands every portal row here before it counts as
 * imported:
 *
 * - A row whose mode was never observed (every bulk row: it comes from a
 *   provider list file, not from the Add form) runs the same endpoint
 *   discovery the single-add form uses first. A list file names the portal
 *   PAGE a reseller hands out (`http://panel/c`); the Stalker API lives at
 *   `portal.php` / `server/load.php` beside it, so seeding the page URL sends
 *   the catalog request to HTML and every row of a working list fails. The
 *   resolved endpoint and the observed mode are persisted with the session
 *   discovery negotiated, and the corrected row is what the import stores.
 * - One page-1 `get_ordered_list` request then proves the portal answers for
 *   this MAC and actually carries live channels; a rejected handshake, an
 *   unreadable panel or an empty list throws, so the bulk import skips the
 *   source and deletes the row's stored playlist, exactly like the Xtream
 *   seeder.
 * - The full channel list is then warmed through `StalkerItvCacheService` in
 *   the background (the workspace loads it the same way on first open), so
 *   the first visit and search do not wait for the crawl. It is deliberately
 *   not awaited: a large panel must not use up the row's one-minute import
 *   budget, and a failed warm just leaves the workspace's own lazy load to
 *   run.
 *
 * Only one page is fetched here, so a portal that pages slowly still imports.
 * Stalker VOD and series catalogs are paged too and are NOT crawled during the
 * import; a VOD-only row is validated with its category list instead.
 */
@Injectable({ providedIn: 'root' })
export class StalkerContentSeedService implements PortalContentSeeder {
    private readonly dataService = inject(DataService);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly portalRepair = inject(StalkerPortalRepairService);
    private readonly itvCache = inject(StalkerItvCacheService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly discovery = inject(StalkerPortalDiscoveryService);
    // Lazy: persistence drags the storage stack and is only needed once a
    // row's real endpoint was discovered — never for an already-resolved one.
    private readonly injector = inject(Injector);
    private readonly requestDeps: StalkerRequestDeps = {
        dataService: this.dataService,
        stalkerSession: this.stalkerSession,
        portalRepair: this.portalRepair,
    };

    async seed(
        playlist: Playlist,
        signal?: AbortSignal
    ): Promise<Playlist | void> {
        if (!playlist._id || !playlist.portalUrl || !playlist.macAddress) {
            return;
        }

        throwIfAborted(signal);
        const source = await this.resolvePortal(playlist);
        throwIfAborted(signal);

        // The global Disable VOD setting leaves every row live-only, exactly
        // like the workspace's own section gate.
        const importVod =
            shouldImportVod(source) &&
            this.settingsStore.disableVod?.() !== true;
        const importLive = shouldImportLive(source) || !importVod;

        if (importLive) {
            const response =
                await executeStalkerRequest<StalkerSeedPageResponse>(
                    this.requestDeps,
                    source,
                    {
                        action: StalkerPortalActions.GetOrderedList,
                        type: 'itv',
                        category: '*',
                        genre: '*',
                        sortby: 'number',
                        p: 1,
                    }
                );
            const channels = response?.js?.data;
            if (!Array.isArray(channels) || channels.length === 0) {
                throw new Error('The source returned no live channels');
            }
            void this.itvCache.ensureLoaded(source).catch(() => undefined);
            return source;
        }

        const response =
            await executeStalkerRequest<StalkerSeedCategoriesResponse>(
                this.requestDeps,
                source,
                {
                    action: StalkerContentTypes.vod.getCategoryAction,
                    type: 'vod',
                }
            );
        if (!Array.isArray(response?.js)) {
            throw new Error('The source did not return categories');
        }
        return source;
    }

    /**
     * Turns a pasted row into the row its portal actually answers on.
     *
     * A row that already carries an observed mode was resolved when it was
     * created (Add form, or an edit), so it is used verbatim. Everything else
     * is a guess: the URL is whatever the provider printed and the mode is
     * unknown. Discovery probes the candidate endpoints and classifies the
     * one that answers by behavior — exactly what the single-add form does —
     * so the seeded catalog request is not aimed at a landing page and a
     * strict portal is handshaked instead of being called token-less.
     */
    private async resolvePortal(playlist: Playlist): Promise<Playlist> {
        if (playlist.isFullStalkerPortal !== undefined) {
            return playlist;
        }

        const outcome = await this.discovery.discover(
            playlist.portalUrl ?? '',
            playlist.macAddress ?? '',
            getStalkerPortalIdentityFromPlaylist(playlist),
            {
                credentials: {
                    username: playlist.username ?? '',
                    password: playlist.password ?? '',
                },
            }
        );

        if (outcome.status === 'unreachable') {
            throw new Error('The source did not answer as a Stalker portal');
        }
        if (outcome.status === 'auth-rejected') {
            // The row is skipped either way, but a `get_profile` that is
            // still on the wire can adopt the MAC's token afterwards, so let
            // it settle instead of racing it with whatever runs next.
            if (outcome.abandonedInFlight) {
                await (outcome.abandonedAuthenticationSettled ??
                    new Promise<void>(() => undefined));
            }
            throw new Error('The portal refused the account');
        }

        const resolved: Playlist = {
            ...playlist,
            portalUrl: outcome.portalUrl,
            isFullStalkerPortal: outcome.isFullStalkerPortal,
            ...(outcome.token
                ? {
                      stalkerToken: outcome.token,
                      stalkerSessionIdentity: stalkerSessionFingerprint({
                          ...playlist,
                          portalUrl: outcome.portalUrl,
                      }),
                      stalkerWatchdogTimeout:
                          outcome.watchdogTimeoutSeconds ??
                          STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS,
                      stalkerTimeslot: outcome.timeslotSeconds ?? 0,
                      ...(outcome.accountInfo
                          ? {
                                stalkerAccountInfo: {
                                    login: outcome.accountInfo.login,
                                    expireDate: outcome.accountInfo.expire_date,
                                    tariffPlanName:
                                        outcome.accountInfo.tariff_plan_name,
                                    status: outcome.accountInfo.status,
                                },
                            }
                          : {}),
                  }
                : {}),
        };

        await this.persistResolvedPortal(resolved);

        if (outcome.isFullStalkerPortal && outcome.token) {
            // Adopt the session the classification handshake negotiated: the
            // seed request below must not handshake again, and the cadence
            // `get_profile` advertised is the one the watchdog needs.
            this.stalkerSession.adoptDiscoveredSession(playlist._id, resolved, {
                token: outcome.token,
                watchdogTimeoutSeconds: outcome.watchdogTimeoutSeconds,
                timeslotSeconds: outcome.timeslotSeconds,
            });
        }

        return resolved;
    }

    /**
     * Writes the discovered endpoint, mode and session onto the stored row.
     * The in-memory row the import stores would otherwise disagree with the
     * database the next start reads — the source would work until the app was
     * restarted and then talk to the landing page again.
     */
    private async persistResolvedPortal(resolved: Playlist): Promise<void> {
        try {
            await firstValueFrom(
                this.injector
                    .get(PlaylistsService)
                    .transformPlaylistMeta(resolved._id, (row) => {
                        // The user may have edited the connection while
                        // discovery ran; never overwrite a different account.
                        if (row.macAddress !== resolved.macAddress) {
                            return null;
                        }
                        const patched: Playlist = {
                            ...row,
                            portalUrl: resolved.portalUrl,
                            isFullStalkerPortal: resolved.isFullStalkerPortal,
                        };
                        if (resolved.stalkerToken) {
                            patched.stalkerToken = resolved.stalkerToken;
                            patched.stalkerSessionIdentity =
                                resolved.stalkerSessionIdentity;
                            patched.stalkerWatchdogTimeout =
                                resolved.stalkerWatchdogTimeout;
                            patched.stalkerTimeslot = resolved.stalkerTimeslot;
                            patched.stalkerAccountInfo =
                                resolved.stalkerAccountInfo;
                        }
                        return patched;
                    })
            );
        } catch (error) {
            // The row still works for this run through the playlist the
            // import stores; only a restart would read the old endpoint
            // again, and the first failure there triggers the lazy repair.
            console.error(
                'Persisting the discovered Stalker endpoint failed',
                error
            );
        }
    }
}

/** Registers the Stalker seeder with the bulk import's seeder list. */
export function provideStalkerContentSeeder(): Provider[] {
    return [
        {
            provide: PORTAL_CONTENT_SEEDERS,
            multi: true,
            useExisting: StalkerContentSeedService,
        },
    ];
}

/** An abandoned row must not keep fetching beside the next import. */
function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        const error = new Error('The import moved on');
        error.name = 'AbortError';
        throw error;
    }
}
