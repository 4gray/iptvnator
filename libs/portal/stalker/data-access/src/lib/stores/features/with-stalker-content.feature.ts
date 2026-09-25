import { computed, inject, resource } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withComputed,
    withMethods,
    withProps,
    withState,
} from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    DataService,
    ParentalLockService,
    resetHostConnectivityGuard,
} from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    StalkerCategoryItem,
    StalkerContentItem,
    StalkerItvChannel,
    StalkerVodSource,
} from '../../models';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerItvCacheService } from '../../stalker-itv-cache.service';
import { StalkerPortalRepairService } from '../../stalker-portal-repair.service';
import { StalkerSessionService } from '../../stalker-session.service';
import {
    ResourceState,
    StalkerCategorySliceContract,
    StalkerContentFeatureStoreContract,
    StalkerContentType,
} from '../stalker-store.contracts';
import {
    executeStalkerRequest,
    filterItvChannelsByGenre,
    toStalkerContentItem,
    toStalkerItvChannel,
    withoutWithheldStalkerItems,
} from '../utils';

/**
 * Genre ids of the given section that the parental lock currently withholds
 * for this portal; empty while unlocked or off.
 */
function withheldStalkerCategoryIds(
    parentalLock: ParentalLockService,
    playlist: PlaylistMeta | undefined,
    contentType: StalkerContentType
): Set<string> {
    const playlistId = playlist?._id;
    if (!playlistId || !parentalLock.active()) {
        return new Set();
    }
    return new Set(parentalLock.lockedStalkerIds(playlistId, contentType));
}

/**
 * Content/categories/channels feature state.
 */
export interface StalkerContentState {
    totalCount: number;
    vodCategories: StalkerCategoryItem[];
    seriesCategories: StalkerCategoryItem[];
    itvCategories: StalkerCategoryItem[];
    radioCategories: StalkerCategoryItem[];
    hasMoreChannels: boolean;
    itvChannels: StalkerItvChannel[];
    /**
     * Who `itvChannels` belong to: the portal AND category they were served
     * for, or `null` while no channels are. Rows lag `selectedCategoryId` —
     * the resource resolves a tick later even when it serves from the
     * full-list cache — so this is the only honest answer to "whose channels
     * are on screen?". Array identity cannot answer it: filtering by `'*'`
     * hands back the cache by reference, and clearing a search replaces the
     * RENDERED list without the source changing at all. The portal is part
     * of the record because a switch keeps the previous portal's rows until
     * its own load lands, and two portals share genre ids.
     */
    itvChannelsSource: { playlistKey: string | null; category: string } | null;
    radioChannels: StalkerItvChannel[];
    paginatedContent: StalkerContentItem[];
    categoryError: unknown;
    contentError: unknown;
    /**
     * A failed append (portal page > 1). Kept separate from `contentError`
     * so already-accumulated pages stay on screen and the grid tail can
     * offer a retry instead of collapsing to the empty state.
     */
    appendError: unknown;
}

const initialContentState: StalkerContentState = {
    totalCount: 0,
    vodCategories: [],
    seriesCategories: [],
    itvCategories: [],
    radioCategories: [],
    hasMoreChannels: false,
    itvChannels: [],
    itvChannelsSource: null,
    radioChannels: [],
    paginatedContent: [],
    categoryError: null,
    contentError: null,
    appendError: null,
};

interface StalkerCategoryResponseItem {
    id?: string | number;
    title?: string;
    censored?: string | number;
}

interface StalkerCategoryResponse {
    js?: StalkerCategoryResponseItem[];
}

interface StalkerOrderedListResponse {
    js?: {
        data?: StalkerVodSource[];
        total_items?: number;
    };
}

interface StalkerContentResourceStoreContract extends StalkerContentFeatureStoreContract {
    categoryResource: ResourceState<StalkerCategoryItem[]>;
    getContentResource: ResourceState<StalkerContentItem[]>;
}

function getCategoriesByType(
    store: StalkerCategorySliceContract,
    contentType: StalkerContentType
): StalkerCategoryItem[] {
    switch (contentType) {
        case 'vod':
            return store.vodCategories();
        case 'series':
            return store.seriesCategories();
        case 'itv':
            return store.itvCategories();
        case 'radio':
            return store.radioCategories();
    }
}

function buildCategoryPatch(
    contentType: StalkerContentType,
    categories: StalkerCategoryItem[]
): Partial<StalkerContentState> {
    switch (contentType) {
        case 'vod':
            return { vodCategories: categories };
        case 'series':
            return { seriesCategories: categories };
        case 'itv':
            return { itvCategories: categories };
        case 'radio':
            return { radioCategories: categories };
    }
}

function buildAllCategory(
    contentType: StalkerContentType,
    translateService: TranslateService
): StalkerCategoryItem {
    return {
        category_name: translateService.instant(
            contentType === 'radio'
                ? 'PORTALS.ALL_RADIO'
                : 'PORTALS.ALL_CATEGORIES'
        ),
        category_id: '*',
    };
}

function prependAllCategory(
    contentType: StalkerContentType,
    categories: StalkerCategoryItem[],
    translateService: TranslateService
): StalkerCategoryItem[] {
    const allIndex = categories.findIndex(
        (category) => category.category_name.trim().toLowerCase() === 'all'
    );

    if (allIndex > 0) {
        categories.unshift(categories.splice(allIndex, 1)[0]);
        return categories;
    }

    if (
        allIndex === -1 &&
        categories.length > 0 &&
        !categories.some((category) => String(category.category_id) === '*')
    ) {
        categories.unshift(buildAllCategory(contentType, translateService));
    }

    return categories;
}

function fallbackRadioCategories(
    translateService: TranslateService
): StalkerCategoryItem[] {
    return [buildAllCategory('radio', translateService)];
}

/** Stable identity of a Stalker portal inside the content resource. */
function stalkerPlaylistKey(
    playlist: { _id?: string; portalUrl?: string } | null | undefined
): string | null {
    return playlist?._id ?? playlist?.portalUrl ?? null;
}

function buildEmptyContentPatch(
    contentType: StalkerContentType,
    error: unknown
): Partial<StalkerContentState> {
    const patch: Partial<StalkerContentState> = {
        totalCount: 0,
        paginatedContent: [],
        contentError: error,
        appendError: null,
    };

    if (contentType === 'itv' || contentType === 'radio') {
        patch.hasMoreChannels = false;
        if (contentType === 'itv') {
            patch.itvChannels = [];
            // The source record describes the rows: cleared rows belong to
            // nobody, or an auto-open handoff for the category these rows
            // CAME from would read the stale marker as proof that its genre
            // is on screen and prepare playback from an empty queue.
            patch.itvChannelsSource = null;
        } else {
            patch.radioChannels = [];
        }
    }

    return patch;
}

/**
 * Portals can shift items between pages while the list is being appended —
 * a duplicate id would render the same card twice and break `track` hints.
 */
function dedupeContentById(items: StalkerContentItem[]): StalkerContentItem[] {
    const seenIds = new Set<string>();
    return items.filter((item) => {
        const id =
            item.id === undefined || item.id === null ? null : String(item.id);
        if (id === null) {
            return true;
        }
        if (seenIds.has(id)) {
            return false;
        }
        seenIds.add(id);
        return true;
    });
}

export function withStalkerContent() {
    const logger = createLogger('withStalkerContent');

    return signalStoreFeature(
        withState<StalkerContentState>(initialContentState),
        withProps(
            (
                store,
                dataService = inject(DataService),
                stalkerSession = inject(StalkerSessionService),
                portalRepair = inject(StalkerPortalRepairService),
                translateService = inject(TranslateService),
                itvCache = inject(StalkerItvCacheService),
                parentalLock = inject(ParentalLockService)
            ) => {
                const storeContext = store as typeof store &
                    StalkerContentResourceStoreContract;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                    portalRepair,
                };

                let lastLivePageKey = '';
                // Withheld (parental-locked) row ids seen while accumulating
                // the current list. A page that adds only withheld ids still
                // counts as progress, so paging continues past it; a page
                // adding nothing new — withheld or not — is a stalled portal.
                let withheldSeenKey = '';
                const withheldSeenIds = new Set<string>();
                return {
                    categoryResource: resource({
                        params: () => ({
                            contentType: storeContext.selectedContentType(),
                            currentPlaylist: storeContext.currentPlaylist(),
                        }),
                        loader: async ({
                            params,
                        }): Promise<StalkerCategoryItem[]> => {
                            if (!params.currentPlaylist) {
                                patchState(store, { categoryError: null });
                                return [];
                            }

                            const cachedCategories = getCategoriesByType(
                                store,
                                params.contentType
                            );
                            if (cachedCategories.length > 0) {
                                patchState(store, { categoryError: null });
                                return cachedCategories;
                            }

                            try {
                                const response =
                                    await executeStalkerRequest<StalkerCategoryResponse>(
                                        requestDeps,
                                        params.currentPlaylist,
                                        {
                                            action: StalkerContentTypes[
                                                params.contentType
                                            ].getCategoryAction,
                                            type: params.contentType,
                                        }
                                    );

                                if (!Array.isArray(response?.js)) {
                                    const invalidResponseError = new Error(
                                        'Invalid categories response'
                                    );
                                    logger.warn(
                                        'Invalid categories response',
                                        response
                                    );
                                    if (params.contentType === 'radio') {
                                        const fallback =
                                            fallbackRadioCategories(
                                                translateService
                                            );
                                        patchState(store, {
                                            radioCategories: fallback,
                                            categoryError: null,
                                        });
                                        return fallback;
                                    }
                                    patchState(store, {
                                        ...buildCategoryPatch(
                                            params.contentType,
                                            []
                                        ),
                                        categoryError: invalidResponseError,
                                    });
                                    return [];
                                }

                                const normalizedCategories = response.js.map(
                                    (item): StalkerCategoryItem => ({
                                        category_name: item.title ?? '',
                                        category_id: String(item.id),
                                        censored:
                                            item.censored === 1 ||
                                            item.censored === '1',
                                    })
                                );
                                const categories = prependAllCategory(
                                    params.contentType,
                                    params.contentType === 'radio' &&
                                        normalizedCategories.length === 0
                                        ? fallbackRadioCategories(
                                              translateService
                                          )
                                        : normalizedCategories,
                                    translateService
                                );

                                patchState(store, {
                                    ...buildCategoryPatch(
                                        params.contentType,
                                        categories
                                    ),
                                    categoryError: null,
                                });

                                return categories;
                            } catch (error) {
                                logger.warn('Error loading categories', {
                                    contentType: params.contentType,
                                    error,
                                });
                                if (params.contentType === 'radio') {
                                    const fallback =
                                        fallbackRadioCategories(
                                            translateService
                                        );
                                    patchState(store, {
                                        radioCategories: fallback,
                                        categoryError: null,
                                    });
                                    return fallback;
                                }
                                patchState(store, {
                                    ...buildCategoryPatch(
                                        params.contentType,
                                        []
                                    ),
                                    categoryError: error,
                                });
                                return [];
                            }
                        },
                    }),
                    getContentResource: resource({
                        params: () => ({
                            contentType: storeContext.selectedContentType(),
                            category: storeContext.selectedCategoryId(),
                            // ITV fields filter locally; server search would narrow
                            // the shared pages behind the independent fullscreen field.
                            search:
                                storeContext.selectedContentType() === 'itv'
                                    ? ''
                                    : storeContext.searchPhrase(),
                            pageIndex: storeContext.page() + 1,
                            currentPlaylist: storeContext.currentPlaylist(),
                            // Re-fires the loader once THIS portal's full ITV
                            // channel list finishes loading or is refreshed.
                            // Read only for ITV and scoped per-portal so a
                            // different portal's (or a radio/vod) load never
                            // re-fires and re-appends this resource's page.
                            itvCacheVersion:
                                storeContext.selectedContentType() === 'itv'
                                    ? itvCache.versionFor(
                                          storeContext.currentPlaylist()
                                      )
                                    : 0,
                            availableCategoryCount: getCategoriesByType(
                                store,
                                storeContext.selectedContentType()
                            ).filter(
                                (category) =>
                                    String(category.category_id) !== '*'
                            ).length,
                            // Lock/unlock re-fires the loader: rows of a
                            // locked genre are dropped at patch time, so the
                            // list must be rebuilt when they become visible.
                            parentalLockVersion: parentalLock.version(),
                        }),
                        loader: async ({
                            params,
                            abortSignal,
                        }): Promise<StalkerContentItem[]> => {
                            if (!params.category || params.category === '') {
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        null
                                    )
                                );
                                return [];
                            }

                            if (
                                params.category === '*' &&
                                (params.contentType === 'vod' ||
                                    params.contentType === 'series') &&
                                params.availableCategoryCount === 0
                            ) {
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        null
                                    )
                                );
                                return [];
                            }

                            const playlist = params.currentPlaylist;
                            if (!playlist?.portalUrl) {
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        null
                                    )
                                );
                                return [];
                            }

                            const categoryParam = params.category || '*';
                            const withheldCategoryIds =
                                withheldStalkerCategoryIds(
                                    parentalLock,
                                    playlist,
                                    params.contentType
                                );

                            if (params.contentType === 'itv') {
                                const cachedChannels =
                                    itvCache.getChannels(playlist);
                                const channels =
                                    cachedChannels !== null
                                        ? withoutWithheldStalkerItems(
                                              filterItvChannelsByGenre(
                                                  cachedChannels,
                                                  categoryParam
                                              ),
                                              params.contentType,
                                              withheldCategoryIds
                                          )
                                        : null;
                                // Serve from the cache only when it actually
                                // has channels for this genre. Censored (adult)
                                // genres are typically EXCLUDED from
                                // get_all_channels by the portal, so an empty
                                // filter result falls through to the legacy
                                // paged fetch, which still returns them.
                                if (
                                    channels !== null &&
                                    (categoryParam === '*' ||
                                        channels.length > 0)
                                ) {
                                    patchState(store, {
                                        totalCount: channels.length,
                                        paginatedContent: channels,
                                        itvChannels: channels,
                                        itvChannelsSource: {
                                            playlistKey:
                                                stalkerPlaylistKey(playlist),
                                            category: String(categoryParam),
                                        },
                                        hasMoreChannels: false,
                                        contentError: null,
                                    });
                                    return channels;
                                }

                                // Full-list load runs in the background; the
                                // resource re-fires via `itvCacheVersion` once
                                // the cache is ready. Until then the legacy
                                // paged flow below serves the first pages.
                                void itvCache.ensureLoaded(playlist);
                            }

                            const paramsPlaylistKey = stalkerPlaylistKey(
                                params.currentPlaylist
                            );
                            const isCurrentRequest = (): boolean => {
                                const currentPlaylist =
                                    storeContext.currentPlaylist();
                                const currentPlaylistKey =
                                    stalkerPlaylistKey(currentPlaylist);

                                return (
                                    !abortSignal.aborted &&
                                    params.contentType ===
                                        storeContext.selectedContentType() &&
                                    params.category ===
                                        storeContext.selectedCategoryId() &&
                                    (params.contentType === 'itv' ||
                                        params.search ===
                                            storeContext.searchPhrase()) &&
                                    params.pageIndex ===
                                        storeContext.page() + 1 &&
                                    paramsPlaylistKey === currentPlaylistKey &&
                                    params.parentalLockVersion ===
                                        parentalLock.version() &&
                                    // A legacy paged response must not overwrite
                                    // the full cached list that a re-fired
                                    // loader served in the meantime. Scoped
                                    // per-portal and to ITV so another portal's
                                    // load never invalidates this response.
                                    params.itvCacheVersion ===
                                        (params.contentType === 'itv'
                                            ? itvCache.versionFor(
                                                  currentPlaylist
                                              )
                                            : 0)
                                );
                            };
                            const queryParams: Record<string, string | number> =
                                {
                                    action: StalkerContentTypes[
                                        params.contentType
                                    ].getContentAction,
                                    type: params.contentType,
                                    sortby: 'added',
                                    ...(params.search !== ''
                                        ? { search: params.search }
                                        : {}),
                                    p: params.pageIndex,
                                };

                            if (params.contentType === 'vod') {
                                queryParams['genre'] = '0';
                                queryParams['category'] = categoryParam;
                            } else if (params.contentType === 'series') {
                                queryParams['category'] = categoryParam;
                            } else if (params.contentType === 'itv') {
                                queryParams['category'] = categoryParam;
                                queryParams['genre'] = categoryParam;
                            } else {
                                queryParams['category'] = categoryParam;
                                queryParams['sortby'] = 'number';
                            }

                            try {
                                // Only a fresh list (page 1) blanks the grid
                                // for the skeleton; appends keep the already
                                // accumulated pages on screen.
                                patchState(store, {
                                    ...(params.pageIndex === 1
                                        ? { paginatedContent: [] }
                                        : {}),
                                    contentError: null,
                                    appendError: null,
                                });

                                const response =
                                    await executeStalkerRequest<StalkerOrderedListResponse>(
                                        requestDeps,
                                        playlist,
                                        queryParams
                                    );

                                if (!isCurrentRequest()) {
                                    return [];
                                }

                                if (!Array.isArray(response?.js?.data)) {
                                    const invalidResponseError = new Error(
                                        'Invalid response structure'
                                    );
                                    logger.warn(
                                        'Invalid response structure',
                                        response
                                    );
                                    if (params.pageIndex > 1) {
                                        // A broken append must not collapse
                                        // the pages already on screen.
                                        patchState(store, {
                                            appendError: invalidResponseError,
                                        });
                                        return store.paginatedContent();
                                    }
                                    patchState(store, {
                                        ...buildEmptyContentPatch(
                                            params.contentType,
                                            invalidResponseError
                                        ),
                                    });
                                    return [];
                                }

                                const rawItems = response.js.data.map((item) =>
                                    toStalkerContentItem(
                                        item,
                                        playlist.portalUrl ?? ''
                                    )
                                );
                                const newItems = withoutWithheldStalkerItems(
                                    rawItems,
                                    params.contentType,
                                    withheldCategoryIds
                                );
                                const listKey = JSON.stringify([
                                    paramsPlaylistKey,
                                    params.contentType,
                                    params.category,
                                    params.search,
                                ]);
                                if (
                                    params.pageIndex === 1 ||
                                    withheldSeenKey !== listKey
                                ) {
                                    withheldSeenKey = listKey;
                                    withheldSeenIds.clear();
                                }
                                let newWithheldCount = 0;
                                if (newItems.length < rawItems.length) {
                                    const kept = new Set(newItems);
                                    for (const item of rawItems) {
                                        if (kept.has(item)) {
                                            continue;
                                        }
                                        const id = String(item.id ?? '');
                                        if (!withheldSeenIds.has(id)) {
                                            withheldSeenIds.add(id);
                                            newWithheldCount += 1;
                                        }
                                    }
                                }
                                // A page made only of withheld rows would
                                // leave the list unchanged; request the next
                                // one so unlocked rows further on still load.
                                const skipWithheldPage = (hasMore: boolean) => {
                                    if (
                                        !hasMore ||
                                        newItems.length > 0 ||
                                        newWithheldCount === 0
                                    ) {
                                        return;
                                    }
                                    queueMicrotask(() => {
                                        if (isCurrentRequest()) {
                                            // `page` belongs to the selection
                                            // feature; the facade composes
                                            // its setter ahead of this one.
                                            (
                                                store as unknown as {
                                                    setPage?: (
                                                        page: number
                                                    ) => void;
                                                }
                                            ).setPage?.(params.pageIndex);
                                        }
                                    });
                                };

                                if (
                                    params.contentType === 'itv' ||
                                    params.contentType === 'radio'
                                ) {
                                    const channels =
                                        newItems.map(toStalkerItvChannel);
                                    const existingChannels =
                                        params.contentType === 'itv'
                                            ? store.itvChannels()
                                            : store.radioChannels();
                                    const nextChannels =
                                        params.pageIndex === 1
                                            ? channels
                                            : dedupeContentById([
                                                  ...existingChannels,
                                                  ...channels,
                                              ]).map(toStalkerItvChannel);

                                    const livePageKey = JSON.stringify([
                                        paramsPlaylistKey,
                                        params.contentType,
                                        params.category,
                                        params.pageIndex,
                                    ]);
                                    // Cache readiness can replay the current censored page.
                                    // A different page adding no ids is a stalled portal.
                                    const replay =
                                        livePageKey === lastLivePageKey;
                                    lastLivePageKey = livePageKey;
                                    const hasMoreChannels =
                                        rawItems.length > 0 &&
                                        (params.pageIndex === 1 ||
                                            replay ||
                                            newWithheldCount > 0 ||
                                            nextChannels.length >
                                                existingChannels.length) &&
                                        nextChannels.length +
                                            withheldSeenIds.size <
                                            (response.js.total_items ?? 0);
                                    patchState(store, {
                                        totalCount:
                                            response.js.total_items ?? 0,
                                        paginatedContent: newItems,
                                        contentError: null,
                                        ...(params.contentType === 'itv'
                                            ? {
                                                  itvChannels: nextChannels,
                                                  itvChannelsSource: {
                                                      playlistKey:
                                                          paramsPlaylistKey,
                                                      category: String(
                                                          params.category ?? '*'
                                                      ),
                                                  },
                                              }
                                            : { radioChannels: nextChannels }),
                                        hasMoreChannels,
                                    });
                                    skipWithheldPage(hasMoreChannels);
                                } else {
                                    // VOD/series pages accumulate into one
                                    // continuous list for the infinite-scroll
                                    // grid; page 1 replaces it.
                                    const previousContent =
                                        store.paginatedContent();
                                    const nextContent =
                                        params.pageIndex === 1
                                            ? newItems
                                            : dedupeContentById([
                                                  ...previousContent,
                                                  ...newItems,
                                              ]);
                                    // An append that adds no unique items is
                                    // the practical end of the list even when
                                    // the portal's total_items claims more
                                    // (dedup after mid-list mutations can
                                    // leave the unique list short forever) —
                                    // clamp the total so hasMoreContent turns
                                    // false instead of requesting past the
                                    // end on every scroll crossing.
                                    const appendStalled =
                                        params.pageIndex > 1 &&
                                        newWithheldCount === 0 &&
                                        nextContent.length <=
                                            previousContent.length;
                                    // Withheld rows count against the portal's
                                    // total, or the grid would keep asking for
                                    // pages the lock will never let it show.
                                    const totalCount = appendStalled
                                        ? nextContent.length
                                        : Math.max(
                                              0,
                                              (response.js.total_items ?? 0) -
                                                  withheldSeenIds.size
                                          );

                                    patchState(store, {
                                        totalCount,
                                        paginatedContent: nextContent,
                                        contentError: null,
                                        appendError: null,
                                        hasMoreChannels: false,
                                    });
                                    skipWithheldPage(
                                        nextContent.length < totalCount
                                    );
                                    return nextContent;
                                }

                                return newItems;
                            } catch (error) {
                                if (!isCurrentRequest()) {
                                    return [];
                                }

                                logger.warn('Error loading content', {
                                    contentType: params.contentType,
                                    category: params.category,
                                    error,
                                });
                                if (params.pageIndex > 1) {
                                    // Keep the accumulated pages; the grid
                                    // tail offers a retry for this page.
                                    patchState(store, { appendError: error });
                                    return store.paginatedContent();
                                }
                                patchState(
                                    store,
                                    buildEmptyContentPatch(
                                        params.contentType,
                                        error
                                    )
                                );
                                return [];
                            }
                        },
                    }),
                };
            }
        ),
        withComputed((store) => {
            const storeContext = store as typeof store &
                StalkerContentResourceStoreContract;
            const itvCache = inject(StalkerItvCacheService);
            const parentalLock = inject(ParentalLockService);

            /**
             * The whole portal's ITV channel list (all categories) when
             * cached, minus the genres the parental lock withholds.
             * `versionFor` establishes the reactive dependency so this
             * recomputes when the list becomes ready or is refreshed.
             */
            const itvFullChannelList = computed(() => {
                const playlist = storeContext.currentPlaylist();
                itvCache.versionFor(playlist);
                parentalLock.version();
                return withoutWithheldStalkerItems(
                    itvCache.getChannels(playlist) ?? [],
                    'itv',
                    withheldStalkerCategoryIds(parentalLock, playlist, 'itv')
                );
            });
            /** The selected section's genres with the withheld ones removed. */
            const visibleCategoryResource = computed(() => {
                parentalLock.version();
                const contentType = storeContext.selectedContentType();
                const withheld = withheldStalkerCategoryIds(
                    parentalLock,
                    storeContext.currentPlaylist(),
                    contentType
                );
                const categories = getCategoriesByType(store, contentType);
                return withheld.size === 0
                    ? categories
                    : categories.filter(
                          (category) =>
                              !withheld.has(String(category.category_id))
                      );
            });

            /**
             * Per-genre channel counts for ITV category badges, keyed by
             * numeric `tv_genre_id` (mirrors the Xtream count map). Only
             * populated when the full list is cached. The "All" pseudo
             * category has id `'*'` → `Number('*')` is NaN, and a Map keys
             * NaN by SameValueZero, so the grand total under `NaN` makes the
             * "All" row show every channel. Genres with NO cached channels
             * get no entry at all: adult genres are excluded from
             * `get_all_channels` (with or without a `censored` flag from
             * `get_genres`), so their real count is unknown and the badge
             * is omitted rather than showing a misleading "0".
             */
            const itvCategoryItemCounts = computed(() => {
                const counts = new Map<number, number>();
                const channels = itvFullChannelList();
                for (const channel of channels) {
                    const genreId = Number(channel.tv_genre_id);
                    if (!Number.isNaN(genreId)) {
                        counts.set(genreId, (counts.get(genreId) ?? 0) + 1);
                    }
                }
                counts.set(Number.NaN, channels.length);
                return counts;
            });

            return {
                /** True when the complete ITV channel list is cached, so local search covers all channels. */
                itvFullListActive: computed(() =>
                    itvCache.isReady(storeContext.currentPlaylist())
                ),
                itvFullListLoading: computed(() =>
                    itvCache.isLoading(storeContext.currentPlaylist())
                ),
                /**
                 * The category the channels on screen were served for, but
                 * only while they belong to the portal on screen: a switch
                 * keeps the previous portal's rows until its own load lands,
                 * and two portals share genre ids.
                 */
                itvChannelsCategory: computed(() => {
                    const source = store.itvChannelsSource();
                    return source &&
                        source.playlistKey ===
                            stalkerPlaylistKey(storeContext.currentPlaylist())
                        ? source.category
                        : null;
                }),
                /** True once the portal proved it cannot serve a full list this session. */
                itvFullListUnsupported: computed(() =>
                    itvCache.isUnsupported(storeContext.currentPlaylist())
                ),
                itvFullListProgress: computed(() =>
                    itvCache.progressOf(storeContext.currentPlaylist())
                ),
                /** Exposes the whole portal's ITV channel list so search can span every channel. */
                itvFullChannelList,
                /**
                 * True when the currently selected ITV category can be served
                 * from the full-list cache. Censored (adult) genres are usually
                 * excluded from `get_all_channels`, so a genre with zero cached
                 * channels stays on the legacy paged flow. O(1): reuses the
                 * memoized per-genre count map instead of re-scanning the list
                 * on every category click.
                 */
                itvSelectedCategoryFromCache: computed(() => {
                    const playlist = storeContext.currentPlaylist();
                    if (!itvCache.isReady(playlist)) {
                        return false;
                    }

                    const categoryId = storeContext.selectedCategoryId();
                    if (!categoryId) {
                        return false;
                    }
                    if (categoryId === '*') {
                        return true;
                    }

                    const genreId = Number(categoryId);
                    if (Number.isNaN(genreId)) {
                        // Non-numeric genre id would collide with the NaN
                        // "All" total key — fall back to the direct scan.
                        return (
                            filterItvChannelsByGenre(
                                itvFullChannelList(),
                                categoryId
                            ).length > 0
                        );
                    }

                    return (itvCategoryItemCounts().get(genreId) ?? 0) > 0;
                }),
                itvCategoryItemCounts,
                /**
                 * Whether the portal reports more items than the grid has
                 * accumulated. Derived from `total_items` versus the actual
                 * list length, so it stays correct even when the portal
                 * ignores requested page sizes.
                 */
                hasMoreContent: computed(
                    () => store.paginatedContent().length < store.totalCount()
                ),
                hasContentAppendError: computed(
                    () => store.appendError() !== null
                ),
                getSelectedCategory: computed(() => {
                    const categoryId = storeContext.selectedCategoryId();
                    if (!categoryId) {
                        return {
                            id: 0,
                            category_name: 'All Items',
                            type: storeContext.selectedContentType(),
                        };
                    }

                    const contentType = storeContext.selectedContentType();
                    const categories = getCategoriesByType(store, contentType);

                    return (
                        categories.find(
                            (category) =>
                                String(category.category_id) ===
                                String(categoryId)
                        ) || {
                            category_id: categoryId,
                            category_name: '',
                            type: contentType,
                        }
                    );
                }),
                getSelectedCategoryName: computed(() => {
                    const selectedCategoryId =
                        storeContext.selectedCategoryId();
                    if (!selectedCategoryId) {
                        return '';
                    }

                    const category = getCategoriesByType(
                        store,
                        storeContext.selectedContentType()
                    ).find(
                        (item) =>
                            String(item.category_id) ===
                            String(selectedCategoryId)
                    );

                    return category?.category_name ?? '';
                }),
                getPaginatedContent: computed(() => store.paginatedContent()),
                isPaginatedContentLoading: computed(() =>
                    storeContext.getContentResource.isLoading()
                ),
                isPaginatedContentFailed: computed(() => store.contentError()),
                getCategoryResource: visibleCategoryResource,
                /** Every genre of the section, locked ones included (lock dialog). */
                getAllCategoriesForSelectedType: computed(() =>
                    getCategoriesByType(
                        store,
                        storeContext.selectedContentType()
                    )
                ),
                isCategoryResourceLoading: computed(() =>
                    storeContext.categoryResource.isLoading()
                ),
                isCategoryResourceFailed: computed(() => store.categoryError()),
            };
        }),
        withMethods((store) => {
            const storeContext = store as typeof store &
                StalkerContentResourceStoreContract;
            const itvCache = inject(StalkerItvCacheService);
            const dataService = inject(DataService);

            return {
                /**
                 * Kicks off the full ITV channel list load as soon as the Live TV
                 * section is entered (instead of waiting for the first category
                 * click), so the all-channels view and category count badges are
                 * available immediately. Safe to call repeatedly — the cache
                 * de-duplicates in-flight loads and memoizes unsupported portals.
                 */
                preloadItvChannels(): Promise<void> {
                    return itvCache.ensureLoaded(
                        storeContext.currentPlaylist()
                    );
                },
                /**
                 * Re-runs the content loader with unchanged params — the retry
                 * for a failed append page.
                 *
                 * The guard reset comes FIRST: two failed appends are exactly what
                 * opens the breaker, so without it this button would fast-fail
                 * without a request and appear to do nothing for 30 seconds.
                 */
                async retryContentPage(): Promise<void> {
                    // Clear the flag synchronously, before the await: otherwise
                    // this stays re-enterable and the next `nearEnd` event
                    // fires a second retry.
                    patchState(store, { appendError: null });
                    await resetHostConnectivityGuard(
                        dataService,
                        storeContext.currentPlaylist()?.portalUrl
                    );
                    storeContext.getContentResource.reload();
                },
                async refreshItvChannels(): Promise<void> {
                    await itvCache.refresh(storeContext.currentPlaylist());
                },
                setCategories(
                    type: StalkerContentType,
                    categories: StalkerCategoryItem[]
                ) {
                    patchState(store, buildCategoryPatch(type, categories));
                },
                resetCategories() {
                    patchState(store, {
                        vodCategories: [],
                        seriesCategories: [],
                        itvCategories: [],
                        radioCategories: [],
                        categoryError: null,
                    });
                },
                setItvChannels(channels: StalkerItvChannel[]) {
                    patchState(store, {
                        itvChannels: channels,
                        // The only caller clears the list for a category the
                        // resource has not served yet, so nothing on screen
                        // belongs to a category until it does.
                        itvChannelsSource: null,
                    });
                },
                setRadioChannels(channels: StalkerItvChannel[]) {
                    patchState(store, { radioChannels: channels });
                },
            };
        })
    );
}
