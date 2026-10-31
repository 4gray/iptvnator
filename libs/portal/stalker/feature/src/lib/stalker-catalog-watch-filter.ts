import { computed, effect, signal, untracked } from '@angular/core';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { createStalkerCatalogPositions } from './stalker-catalog-positions';

export const STALKER_HIDDEN_PAGE_BUDGET = 3;

/** A bounded scan over raw provider pages, independent of rendered height. */
export function createStalkerCatalogWatchFilter(
    store: InstanceType<typeof StalkerStore>,
    positions: ReturnType<typeof createStalkerCatalogPositions>
) {
    const preference = signal(false);
    const preferenceOwner = signal<string | null>(null);
    const paused = signal(false);
    const scanning = signal(false);
    const resumeVersion = signal(0);
    const enabled = computed(
        () =>
            store.selectedContentType() === 'vod' &&
            preferenceOwner() === store.currentPlaylist()?._id &&
            preference()
    );
    const items = computed(() => {
        const raw = store.getPaginatedContent() ?? [];
        return enabled() && positions.hasSnapshot()
            ? raw.filter(
                  (item) =>
                      positions.getItemProgress(item).watchState !== 'watched'
              )
            : raw;
    });
    const loading = () =>
        store.isPaginatedContentLoading() || store.isContentRetrying();
    let identity = '';
    let pending: {
        page: number;
        before: number;
        raw: ReturnType<typeof store.getPaginatedContent>;
        started: boolean;
    } | null = null;
    let hiddenPages = 0;

    function cancel(): void {
        pending = null;
        hiddenPages = 0;
        paused.set(false);
        scanning.set(false);
    }
    function requestNext(): void {
        pending = {
            page: store.page() + 1,
            before: items().length,
            raw: store.getPaginatedContent(),
            started: false,
        };
        scanning.set(true);
        store.nextPage();
    }
    function loadMore(): void {
        if (
            loading() ||
            scanning() ||
            paused() ||
            store.selectedItem() ||
            store.hasContentAppendError() ||
            !store.hasMoreContent()
        )
            return;
        if (!enabled()) {
            store.nextPage();
            return;
        }
        if (!positions.hasSnapshot()) return;
        hiddenPages = 0;
        requestNext();
    }

    effect(() => {
        const id = store.currentPlaylist()?._id ?? null;
        untracked(() => {
            if (preferenceOwner() !== id) {
                preferenceOwner.set(id);
                preference.set(false);
            }
        });
    });
    effect(() => {
        const nextIdentity = JSON.stringify([
            store.currentPlaylist()?._id,
            store.selectedContentType(),
            store.selectedCategoryId(),
            store.searchPhrase(),
            enabled(),
        ]);
        const busy = loading();
        const raw = store.getPaginatedContent();
        const page = store.page();
        const failed = store.hasContentAppendError();
        const selected = store.selectedItem();
        const count = items().length;
        const hasMore = store.hasMoreContent();
        untracked(() => {
            if (nextIdentity !== identity) {
                identity = nextIdentity;
                cancel();
                return;
            }
            if (!pending) return;
            if (selected || failed || page !== pending.page) {
                cancel();
                return;
            }
            if (busy) {
                pending.started = true;
                return;
            }
            if (!pending.started && raw === pending.raw) return;
            const grew = count > pending.before;
            pending = null;
            if (grew || !hasMore) {
                cancel();
                return;
            }
            hiddenPages++;
            if (hiddenPages >= STALKER_HIDDEN_PAGE_BUDGET) {
                paused.set(true);
                scanning.set(false);
            } else requestNext();
        });
    });

    return {
        enabled,
        items,
        paused,
        scanning,
        resumeVersion,
        loadState: positions.loadState,
        hasSnapshot: positions.hasSnapshot,
        setEnabled(value: boolean): void {
            if (
                value &&
                (store.selectedContentType() !== 'vod' ||
                    !positions.hasSnapshot())
            )
                return;
            preferenceOwner.set(store.currentPlaylist()?._id ?? null);
            preference.set(value);
            cancel();
        },
        retryPositions(): void {
            const id = store.currentPlaylist()?._id;
            if (id) void positions.refresh(id).catch(() => undefined);
        },
        pauseAutomaticLoading(): void {
            if (enabled() && store.hasMoreContent() && !scanning())
                paused.set(true);
        },
        continueLoading(): void {
            if (loading() || scanning()) return;
            cancel();
            resumeVersion.update((value) => value + 1);
            loadMore();
        },
        loadMore,
    };
}
