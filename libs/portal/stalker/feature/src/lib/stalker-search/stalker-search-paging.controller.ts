import {
    type Signal,
    computed,
    linkedSignal,
    resource,
    signal,
} from '@angular/core';
import type { Logger } from '@iptvnator/portal/shared/util';
import {
    executeStalkerRequest,
    type StalkerPortalRepairService,
    type StalkerSessionService,
    type StalkerVodSource,
    withoutWithheldStalkerItems,
} from '@iptvnator/portal/stalker/data-access';
import {
    type DataService,
    type ParentalLockService,
    resetHostConnectivityGuard,
} from '@iptvnator/services';
import {
    type PlaylistMeta,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { isStalkerSearchRequestCurrent } from './stalker-search-request.util';
import {
    buildStalkerSearchRequestParams,
    dedupeSearchResults,
    recordNewWithheldRows,
    resolveSearchWithheldCategoryIds,
    type StalkerSearchContentType,
    type StalkerSearchResponse,
    withAbsoluteScreenshotUri,
} from './stalker-search-results.util';

interface StalkerSearchPagingControllerConfig {
    searchTerm: Signal<string>;
    selectedFilterType: Signal<StalkerSearchContentType>;
    /** The portal being searched; null while none is resolved. */
    currentPlaylist: Signal<PlaylistMeta | null>;
    dataService: DataService;
    parentalLock: ParentalLockService;
    stalkerSession: StalkerSessionService;
    portalRepair: StalkerPortalRepairService;
    logger: Logger;
    /** Closes the host's open detail when its genre became withheld. */
    closeWithheldDetail: (withheldCategoryIds: ReadonlySet<string>) => void;
}

/**
 * Owns the result paging of the Stalker search page: the portal page being
 * requested, the pages accumulated into one list and the parental-lock
 * bookkeeping that decides whether paging continues.
 */
export class StalkerSearchPagingController {
    /** Lock version the accumulated results were built under. */
    private searchResultsLockVersion: number | null = null;
    /**
     * Withheld row ids seen for the current search identity. A page adding
     * only new withheld ids is still progress and is skipped automatically;
     * a page adding nothing new is the end of the results.
     */
    private searchWithheldKey = '';
    private readonly searchWithheldIds = new Set<string>();

    constructor(private readonly config: StalkerSearchPagingControllerConfig) {}

    /**
     * Portal page for the current term+filter+portal; resets when any of
     * them changes. The playlist belongs to the identity: Angular reuses the
     * search route across `/stalker/A/search` -> `/stalker/B/search`, and a
     * surviving page number would append portal B's later page onto portal
     * A's accumulated results while skipping B's first page.
     */
    readonly searchPage = linkedSignal({
        source: () => ({
            term: this.config.searchTerm(),
            type: this.config.selectedFilterType(),
            playlistId: this.config.currentPlaylist()?._id ?? null,
        }),
        computation: () => 1,
    });
    /** Pages accumulated into one continuous, deduplicated result list. */
    private readonly accumulatedSearchResults = signal<StalkerVodSource[]>([]);
    readonly searchResults = this.accumulatedSearchResults.asReadonly();
    readonly searchHasMore = signal(false);
    /**
     * A failed append page. The next near-end RETRIES that page instead of
     * advancing — incrementing past it would silently omit its results.
     */
    readonly searchAppendError = signal(false);

    readonly searchResultsResource = resource({
        params: () => ({
            contentType: this.config.selectedFilterType(),
            search: this.config.searchTerm(),
            page: this.searchPage(),
            playlistId: this.config.currentPlaylist()?._id ?? null,
            action: StalkerPortalActions.GetOrderedList,
            // Lock/unlock re-fires the search: withheld rows are dropped at
            // page time, so the results must be rebuilt when they change.
            parentalLockVersion: this.config.parentalLock.version(),
        }),
        loader: async ({ params }) => {
            if (params.search.length < 3) {
                this.resetSearchAccumulator();
                return [];
            }
            const playlist = this.config.currentPlaylist();
            if (!playlist) {
                // A reused route can land on a deleted/unresolved portal —
                // the previous portal's cards must not keep rendering.
                this.resetSearchAccumulator();
                return [];
            }
            const { portalUrl, macAddress } = playlist;
            if (!portalUrl || !macAddress) {
                this.resetSearchAccumulator();
                return [];
            }
            const contentType = params.contentType;
            const withheldCategoryIds = resolveSearchWithheldCategoryIds(
                this.config.parentalLock,
                playlist._id,
                contentType
            );
            const lockVersionChanged =
                this.searchResultsLockVersion !== null &&
                this.searchResultsLockVersion !== params.parentalLockVersion;
            this.searchResultsLockVersion = params.parentalLockVersion;
            if (lockVersionChanged) {
                this.applyRelockToResults(withheldCategoryIds, contentType);
            }
            if (lockVersionChanged && params.page > 1) {
                // A lock flip past page 1: rebuild from page 1 rather than
                // appending to pages accumulated under the old lock state.
                this.searchPage.set(1);
                return this.accumulatedSearchResults();
            }
            const withheldKey = JSON.stringify([
                params.playlistId,
                contentType,
                params.search,
                params.parentalLockVersion,
            ]);
            if (params.page === 1 || this.searchWithheldKey !== withheldKey) {
                this.searchWithheldKey = withheldKey;
                this.searchWithheldIds.clear();
            }

            const requestParams = buildStalkerSearchRequestParams(
                contentType,
                params.search,
                params.page
            );

            // A stale response (term/filter/page/portal — or the parental
            // lock — moved on while this page was in flight) must not clobber
            // the accumulated list: the request is not aborted, and a
            // pre-relock response was filtered with the pre-relock set.
            const isCurrent = (): boolean =>
                isStalkerSearchRequestCurrent(params, {
                    search: this.config.searchTerm(),
                    contentType: this.config.selectedFilterType(),
                    page: this.searchPage(),
                    playlistId: this.config.currentPlaylist()?._id ?? null,
                    parentalLockVersion: this.config.parentalLock.version(),
                });

            try {
                // executeStalkerRequest owns the portal-mode decision (shared
                // predicate with URL fallback for legacy rows) and the lazy
                // portal repair, so search cannot drift from the catalog
                // paths.
                const response =
                    await executeStalkerRequest<StalkerSearchResponse>(
                        {
                            dataService: this.config.dataService,
                            stalkerSession: this.config.stalkerSession,
                            portalRepair: this.config.portalRepair,
                        },
                        playlist,
                        requestParams
                    );
                const rawItems = (response.js?.data || []).map(
                    (item: StalkerVodSource) =>
                        withAbsoluteScreenshotUri(item, portalUrl)
                );
                const items = withoutWithheldStalkerItems(
                    rawItems,
                    contentType,
                    withheldCategoryIds
                );
                // Before the withheld-id bookkeeping: a stale page must not
                // pre-record ids into a set a newer relock request cleared,
                // or that request's page counts no new withheld rows and
                // stops paging short of later visible matches.
                if (!isCurrent()) {
                    return items;
                }
                const newWithheldCount = recordNewWithheldRows(
                    rawItems,
                    items,
                    this.searchWithheldIds
                );

                const merged = this.applySearchPageSuccess(
                    params.page,
                    items,
                    response.js?.total_items,
                    // A page made only of withheld rows still is a page the
                    // portal served; judge progress on what it sent.
                    rawItems.length > 0 &&
                        (items.length > 0 || newWithheldCount > 0)
                );
                this.advancePastWithheldPage(
                    params.page,
                    items.length,
                    newWithheldCount,
                    isCurrent
                );
                return merged;
            } catch (error) {
                this.config.logger.warn('Stalker search page failed', {
                    page: params.page,
                    error,
                });
                if (!isCurrent()) {
                    return this.accumulatedSearchResults();
                }

                return this.applySearchPageFailure(params.page);
            }
        },
    });

    /**
     * Empties the accumulator and every paging flag — used whenever there is
     * no searchable portal (short term, missing playlist, malformed row).
     */
    resetSearchAccumulator(): void {
        this.accumulatedSearchResults.set([]);
        this.searchHasMore.set(false);
        this.searchAppendError.set(false);
    }

    /** Merges a successful portal page into the accumulated result list. */
    applySearchPageSuccess(
        page: number,
        items: StalkerVodSource[],
        totalItems: number | undefined,
        pageHadRows: boolean = items.length > 0
    ): StalkerVodSource[] {
        const previous = page === 1 ? [] : this.accumulatedSearchResults();
        const merged =
            page === 1 ? items : dedupeSearchResults([...previous, ...items]);
        // Paging continues only while pages make progress — with OR without
        // a reported total. Dedup after mid-list portal mutations can leave
        // the unique list permanently shorter than total_items, and a
        // repeated page dedupes to no growth; either way a no-progress
        // append is the practical end of the results. A page whose rows were
        // all withheld by the parental lock counts as progress too.
        const withheldRows = pageHadRows && items.length === 0;
        const madeProgress =
            page === 1 || merged.length > previous.length || withheldRows;
        this.searchHasMore.set(
            madeProgress &&
                (typeof totalItems === 'number' && totalItems >= 0
                    ? merged.length < totalItems
                    : pageHadRows)
        );
        this.searchAppendError.set(false);
        this.accumulatedSearchResults.set(merged);
        return merged;
    }

    /**
     * A failed FRESH search (page 1) must not keep rendering the previous
     * query's cards; a failed append keeps the accumulated pages and flags
     * the error so the next near-end retries this page instead of advancing.
     */
    applySearchPageFailure(page: number): StalkerVodSource[] {
        if (page === 1) {
            this.accumulatedSearchResults.set([]);
            this.searchHasMore.set(false);
            this.searchAppendError.set(false);
            return [];
        }

        this.searchAppendError.set(true);
        return this.accumulatedSearchResults();
    }

    /**
     * Result-set identity for the layout's near-end latch and auto-fill
     * budget — term, filter, and portal, mirroring the paging identity.
     */
    readonly searchScrollResetKey = computed(() =>
        [
            this.config.searchTerm(),
            this.config.selectedFilterType(),
            this.config.currentPlaylist()?._id ?? '',
        ].join('|')
    );

    readonly isInitialSearchLoading = computed(
        () => this.searchResultsResource.isLoading() && this.searchPage() === 1
    );
    readonly isAppendingSearchResults = computed(
        () => this.searchResultsResource.isLoading() && this.searchPage() > 1
    );

    loadMoreSearchResults(): void {
        if (this.searchResultsResource.isLoading() || !this.searchHasMore()) {
            return;
        }

        if (this.searchAppendError()) {
            // Retry the SAME page — advancing would permanently omit it.
            void this.retrySearchPage();
            return;
        }

        this.searchPage.update((page) => page + 1);
    }

    /**
     * Two failed search pages are exactly what opens the main process'
     * connectivity guard, so the reset has to precede the reload — otherwise
     * this retry fast-fails without contacting a portal that may have
     * recovered, and keeps repeating the same error until the window expires.
     */
    private async retrySearchPage(): Promise<void> {
        // Clear the flag synchronously: awaiting first would leave this branch
        // re-enterable, and the next `nearEnd` event would fire a second retry.
        this.searchAppendError.set(false);
        await resetHostConnectivityGuard(
            this.config.dataService,
            this.config.currentPlaylist()?.portalUrl
        );
        this.searchResultsResource.reload();
    }

    /**
     * The infinite scroll gives up after a few loads that add no height, so
     * a run of pages made only of parental-locked rows must advance by
     * itself until a visible row (or the real end) is reached. Only a page
     * that added withheld ids not seen before counts — a stalled portal
     * repeating the same locked rows must still end the loop.
     */
    advancePastWithheldPage(
        page: number,
        visibleCount: number,
        newWithheldCount: number,
        isCurrent: () => boolean
    ): void {
        if (
            visibleCount > 0 ||
            newWithheldCount === 0 ||
            !this.searchHasMore()
        ) {
            return;
        }
        queueMicrotask(() => {
            if (isCurrent()) {
                this.searchPage.set(page + 1);
            }
        });
    }

    /**
     * A lock change reached the results on screen, which were read under
     * the old lock state: close an open detail of a now-withheld genre (the
     * list hiding it is not enough) and drop the withheld rows NOW, before
     * the replacement page is awaited — on page 1 too, or they stay
     * clickable while (or, if it hangs, after) that request is pending.
     */
    applyRelockToResults(
        withheldCategoryIds: ReadonlySet<string>,
        contentType: Parameters<typeof withoutWithheldStalkerItems>[1]
    ): void {
        this.config.closeWithheldDetail(withheldCategoryIds);
        this.accumulatedSearchResults.set(
            withoutWithheldStalkerItems(
                this.accumulatedSearchResults(),
                contentType,
                withheldCategoryIds
            )
        );
    }
}
