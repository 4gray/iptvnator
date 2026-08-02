import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    type,
    withMethods,
} from '@ngrx/signals';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService } from '@iptvnator/services';
import {
    PlaylistMeta,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerVodSource } from '../../models';
import { StalkerPortalRepairService } from '../../stalker-portal-repair.service';
import { StalkerSessionService } from '../../stalker-session.service';
import { normalizeStalkerEntityId } from '../../stalker-vod.utils';
import { StalkerPortalStoreContract } from '../stalker-store.contracts';
import { executeStalkerRequest, StalkerRequestDeps } from '../utils';

interface StalkerOrderedListResponse {
    js?: {
        data?: StalkerVodSource[];
        total_items?: number | string;
        max_page_items?: number | string;
        total_pages?: number | string;
    };
}

/** Upper bound on paginated search pages scanned per category attempt. */
const MAX_SEARCH_PAGES = 5;

/**
 * Favorites/recently-viewed rows store embedded-series ("vclub") items as
 * full JSON snapshots, so their episode list (`series[]`) and playback
 * `cmd` freeze at the moment the snapshot was written. This feature
 * re-fetches the item from the portal in the background and patches the
 * live selection, so newly released episodes appear when a series is
 * opened from favorites, recents, or the dashboard.
 */
export function withStalkerSnapshotRefresh() {
    const logger = createLogger('withStalkerSnapshotRefresh');

    return signalStoreFeature(
        {
            state: type<{
                selectedItem: StalkerVodSource | null | undefined;
            }>(),
        },
        withMethods(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService),
                portalRepair = inject(StalkerPortalRepairService)
            ) => {
                const storeContext = store as typeof store &
                    StalkerPortalStoreContract;
                const requestDeps: StalkerRequestDeps = {
                    dataService,
                    stalkerSession,
                    portalRepair,
                };

                const findFreshRow = async (
                    playlist: PlaylistMeta,
                    snapshotId: string,
                    title: string,
                    category: string
                ): Promise<StalkerVodSource | null> => {
                    // Short/reused titles can push the item past page 1, so
                    // follow the portal's reported page count (bounded).
                    let totalPages = 1;
                    for (let page = 1; page <= totalPages; page += 1) {
                        const response =
                            await executeStalkerRequest<StalkerOrderedListResponse>(
                                requestDeps,
                                playlist,
                                {
                                    action: StalkerPortalActions.GetOrderedList,
                                    type: 'vod',
                                    sortby: 'added',
                                    genre: '0',
                                    category,
                                    search: title,
                                    p: page,
                                }
                            );

                        const rows = Array.isArray(response?.js?.data)
                            ? response.js.data
                            : [];
                        const match = rows.find((row) => {
                            const rowId = normalizeStalkerEntityId(
                                row?.id ?? row?.stream_id
                            );
                            return rowId !== '' && rowId === snapshotId;
                        });
                        if (match) {
                            return match;
                        }
                        if (rows.length === 0) {
                            return null;
                        }

                        totalPages = Math.min(
                            resolveTotalPages(response),
                            MAX_SEARCH_PAGES
                        );
                    }

                    return null;
                };

                return {
                    /**
                     * Re-fetches the currently selected embedded-series item
                     * via a portal title search and patches the selection
                     * when the episode list or cmd changed. Safe to fire and
                     * forget; resolves to true when the selection changed.
                     */
                    async refreshEmbeddedSeriesSelection(): Promise<boolean> {
                        const playlist = storeContext.currentPlaylist();
                        const snapshot = store.selectedItem();
                        const snapshotId = normalizeStalkerEntityId(
                            snapshot?.id ?? snapshot?.stream_id
                        );
                        const title = resolveSnapshotTitle(snapshot);

                        if (
                            !playlist?._id ||
                            !snapshot ||
                            !snapshotId ||
                            !hasEmbeddedSeries(snapshot) ||
                            !title
                        ) {
                            return false;
                        }

                        let fresh: StalkerVodSource | null = null;
                        try {
                            const category = toSearchCategory(
                                snapshot.category_id
                            );
                            fresh = await findFreshRow(
                                playlist,
                                snapshotId,
                                title,
                                category
                            );
                            if (!fresh && category !== '*') {
                                fresh = await findFreshRow(
                                    playlist,
                                    snapshotId,
                                    title,
                                    '*'
                                );
                            }
                        } catch (error) {
                            logger.debug(
                                'Embedded-series snapshot refresh failed',
                                error
                            );
                            return false;
                        }

                        if (!fresh || !hasEmbeddedSeries(fresh)) {
                            return false;
                        }

                        // The user may have navigated on while the portal
                        // request was in flight — never patch a selection
                        // that no longer belongs to this snapshot. Stalker
                        // item IDs are only unique per portal, so the active
                        // playlist must still be the one that was queried.
                        const current = store.selectedItem();
                        if (
                            storeContext.currentPlaylist()?._id !==
                                playlist._id ||
                            !current ||
                            normalizeStalkerEntityId(
                                current.id ?? current.stream_id
                            ) !== snapshotId
                        ) {
                            return false;
                        }

                        const nextCmd =
                            typeof fresh.cmd === 'string' &&
                            fresh.cmd.trim() !== ''
                                ? fresh.cmd
                                : current.cmd;
                        if (
                            nextCmd === current.cmd &&
                            sameEpisodeList(current.series, fresh.series)
                        ) {
                            return false;
                        }

                        // Only the in-memory selection is patched. The stored
                        // snapshot is deliberately left untouched: every entry
                        // path into the detail view runs this refresh, so a
                        // stale stored episode list is never rendered for
                        // longer than one background request, and writing it
                        // back would add an uncontrolled background writer to
                        // the whole-playlist read-modify-write used by every
                        // favorite/recent mutation.
                        patchState(store, {
                            selectedItem: {
                                ...current,
                                series: fresh.series,
                                cmd: nextCmd,
                            },
                        });

                        return true;
                    },
                };
            }
        )
    );
}

function hasEmbeddedSeries(
    item: StalkerVodSource | null | undefined
): item is StalkerVodSource & { series: unknown[] } {
    return Array.isArray(item?.series) && item.series.length > 0;
}

function resolveSnapshotTitle(
    item: StalkerVodSource | null | undefined
): string {
    const title = String(
        item?.info?.name ?? item?.name ?? item?.title ?? item?.o_name ?? ''
    ).trim();
    return title === 'Unknown' ? '' : title;
}

function resolveTotalPages(response: StalkerOrderedListResponse): number {
    const js = response?.js;
    const declared = Number(js?.total_pages);
    if (Number.isFinite(declared) && declared > 0) {
        return Math.floor(declared);
    }

    const totalItems = Number(js?.total_items);
    const pageSize = Number(js?.max_page_items);
    if (
        Number.isFinite(totalItems) &&
        Number.isFinite(pageSize) &&
        pageSize > 0
    ) {
        return Math.max(1, Math.ceil(totalItems / pageSize));
    }

    return 1;
}

/** Portals expect a real category id; snapshot ids like 'vod'/'series' are routing artifacts. */
function toSearchCategory(categoryId: unknown): string {
    const raw = String(categoryId ?? '').trim();
    return /^\d+$/.test(raw) ? raw : '*';
}

function sameEpisodeList(
    a: unknown[] | undefined,
    b: unknown[] | undefined
): boolean {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    if (left.length !== right.length) {
        return false;
    }
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}
