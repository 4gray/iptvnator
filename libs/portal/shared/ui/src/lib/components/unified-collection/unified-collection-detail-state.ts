import { isCatalogUnavailable } from '@iptvnator/shared/interfaces';
import {
    computed,
    effect,
    inject,
    signal,
    Signal,
    untracked,
    WritableSignal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
    clearNavigationStateKeys,
    CollectionContentType,
    getOpenCollectionDetailItemState,
    OPEN_COLLECTION_DETAIL_STATE_KEY,
    SeriesResumeTarget,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { CollectionMode } from '@iptvnator/portal/shared/data-access';
import {
    buildCollectionDetailNavigation,
    canRenderCollectionDetailOnRoute,
} from './unified-collection-detail-navigation';
import { UnifiedCollectionDetailContext } from './unified-collection-detail.directive';

export interface CollectionDetailState {
    readonly item: WritableSignal<UnifiedCollectionItem | null>;
    readonly seriesResume: WritableSignal<SeriesResumeTarget | null>;
    /** Template context for the host's projected detail template. */
    readonly context: Signal<UnifiedCollectionDetailContext | null>;
    /** A navigation handoff is waiting for collection validation. */
    readonly isPending: Signal<boolean>;
    /** Whether this route and host can render the item's detail in place. */
    canOpen(item: UnifiedCollectionItem): boolean;
    open(
        item: UnifiedCollectionItem,
        seriesResume?: SeriesResumeTarget | null
    ): void;
    clear(): void;
    /** Open, keep, or close the inline detail per the history entry. */
    syncFromHistory(): void;
}

/**
 * The detail a collection renders in place of its list. Only the portal
 * providers have one, and only where the host projected a detail template;
 * an item belonging to a provider this route cannot render is handed over to
 * the matching global collection instead of being dropped.
 *
 * Must run in an injection context (the hosting component's field
 * initializer or constructor).
 */
export function createCollectionDetailState(options: {
    mode: Signal<CollectionMode>;
    items: Signal<UnifiedCollectionItem[]>;
    isLoading: Signal<boolean>;
    portalType: Signal<string | undefined>;
    /** Absent while the host projects no detail template. */
    detailTemplate: Signal<unknown>;
    /** Show the tab the opened item belongs to. */
    onOpen: (contentType: CollectionContentType) => void;
    /** The detail closed: fall back to a tab that still has rows. */
    onClear: () => void;
}): CollectionDetailState {
    const router = inject(Router);
    const item = signal<UnifiedCollectionItem | null>(null);
    const seriesResume = signal<SeriesResumeTarget | null>(null);
    const pendingItem = signal(
        getOpenCollectionDetailItemState(window.history.state)?.item ?? null
    );

    const canRenderOnCurrentRoute = (
        candidate: UnifiedCollectionItem
    ): boolean =>
        canRenderCollectionDetailOnRoute(
            router.url,
            options.portalType(),
            candidate
        );

    const canOpen = (candidate: UnifiedCollectionItem): boolean =>
        !isCatalogUnavailable(candidate) &&
        Boolean(options.detailTemplate()) &&
        candidate.contentType !== 'live' &&
        (candidate.sourceType === 'xtream' ||
            candidate.sourceType === 'stalker') &&
        canRenderOnCurrentRoute(candidate);

    const open = (
        next: UnifiedCollectionItem,
        nextSeriesResume?: SeriesResumeTarget | null
    ): void => {
        if (isCatalogUnavailable(next)) return;
        options.onOpen(next.contentType);
        item.set(next);
        seriesResume.set(nextSeriesResume ?? null);
    };

    const clear = (): void => {
        pendingItem.set(null);
        item.set(null);
        seriesResume.set(null);
        options.onClear();
        clearNavigationStateKeys([OPEN_COLLECTION_DETAIL_STATE_KEY]);
    };

    const requestClose = (): void => {
        if (getOpenCollectionDetailItemState(window.history.state)) {
            window.history.back();
            return;
        }

        clear();
    };

    // A detail this route cannot render (a Stalker item inside an Xtream
    // portal's own tabs, say) belongs to the matching global collection.
    effect(() => {
        const current = item();
        if (!current || canRenderOnCurrentRoute(current)) {
            return;
        }

        const navigation = buildCollectionDetailNavigation(
            options.mode(),
            current,
            seriesResume()
        );
        if (!navigation) {
            return;
        }

        untracked(() => {
            item.set(null);
            void router.navigate(navigation.link, {
                state: navigation.state,
            });
        });
    });

    const syncFromHistory = (): void => {
        const detailState = getOpenCollectionDetailItemState(
            window.history.state
        );
        const savedItem = detailState?.item;
        pendingItem.set(savedItem ?? null);
        if (options.isLoading()) return;
        const currentItem =
            savedItem &&
            options.items().find((row) => row.uid === savedItem.uid);
        // The catalog may have changed since this history entry was written.
        // Unrelated dashboard discoveries need not be a saved favorite.
        const detailItem =
            currentItem ??
            (savedItem?.favoriteId != null && options.mode() === 'favorites'
                ? null
                : savedItem);

        pendingItem.set(null);
        if (detailItem && canOpen(detailItem)) {
            open(detailItem, detailState?.seriesResume);
            return;
        }

        if (item()) {
            clear();
        }
    };

    effect(() => {
        options.items();
        if (!options.isLoading()) untracked(syncFromHistory);
    });

    return {
        item,
        seriesResume,
        isPending: computed(() => {
            const pending = pendingItem();
            return !!pending && canOpen(pending);
        }),
        context: computed<UnifiedCollectionDetailContext | null>(() => {
            const current = item();
            if (!current) {
                return null;
            }

            return {
                $implicit: current,
                item: current,
                seriesResume: seriesResume(),
                close: requestClose,
            };
        }),
        canOpen,
        open,
        clear,
        syncFromHistory,
    };
}
