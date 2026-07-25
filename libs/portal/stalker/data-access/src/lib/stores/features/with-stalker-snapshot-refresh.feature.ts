import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    type,
    withMethods,
} from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { createLogger } from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from '@iptvnator/services';
import {
    PlaylistMeta,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerVodSource } from '../../models';
import { StalkerSessionService } from '../../stalker-session.service';
import { normalizeStalkerEntityId } from '../../stalker-vod.utils';
import { StalkerPortalStoreContract } from '../stalker-store.contracts';
import {
    dispatchStalkerPlaylistMetaUpdate,
    executeStalkerRequest,
    StalkerRequestDeps,
} from '../utils';

interface StalkerOrderedListResponse {
    js?: {
        data?: StalkerVodSource[];
    };
}

/**
 * Favorites/recently-viewed rows store embedded-series ("vclub") items as
 * full JSON snapshots, so their episode list (`series[]`) and playback
 * `cmd` freeze at the moment the snapshot was written. This feature
 * re-fetches the item from the portal in the background and patches both
 * the live selection and the stored snapshots, so newly released episodes
 * appear when a series is opened from favorites, recents, or the dashboard.
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
                playlistService = inject(PlaylistsService),
                ngrxStore = inject(Store)
            ) => {
                const storeContext = store as typeof store &
                    StalkerPortalStoreContract;
                const requestDeps: StalkerRequestDeps = {
                    dataService,
                    stalkerSession,
                };

                const findFreshRow = async (
                    playlist: PlaylistMeta,
                    snapshotId: string,
                    title: string,
                    category: string
                ): Promise<StalkerVodSource | null> => {
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
                                p: 1,
                            }
                        );

                    const rows = Array.isArray(response?.js?.data)
                        ? response.js.data
                        : [];
                    return (
                        rows.find((row) => {
                            const rowId = normalizeStalkerEntityId(
                                row?.id ?? row?.stream_id
                            );
                            return rowId !== '' && rowId === snapshotId;
                        }) ?? null
                    );
                };

                return {
                    /**
                     * Re-fetches the currently selected embedded-series item
                     * via a portal title search and, when the episode list or
                     * cmd changed, patches the selection and rewrites the
                     * stored favorite/recently-viewed snapshots. Safe to fire
                     * and forget; resolves to true when anything was updated.
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
                        // that no longer belongs to this snapshot.
                        const current = store.selectedItem();
                        if (
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

                        patchState(store, {
                            selectedItem: {
                                ...current,
                                series: fresh.series,
                                cmd: nextCmd,
                            },
                        });

                        try {
                            const updated = await firstValueFrom(
                                playlistService.updatePortalCollectionSnapshots(
                                    playlist._id,
                                    snapshotId,
                                    { series: fresh.series, cmd: nextCmd }
                                )
                            );
                            dispatchStalkerPlaylistMetaUpdate(
                                ngrxStore,
                                playlist._id,
                                {
                                    favorites: updated?.favorites,
                                    recentlyViewed: updated?.recentlyViewed,
                                }
                            );
                        } catch (error) {
                            logger.warn(
                                'Failed to persist refreshed embedded-series snapshot',
                                error
                            );
                        }

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
