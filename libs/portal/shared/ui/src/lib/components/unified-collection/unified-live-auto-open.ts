import { effect, type Signal } from '@angular/core';
import type { ResolvedLiveCollectionDetail } from '@iptvnator/portal/shared/data-access';
import {
    matchesOpenLiveCollectionItem,
    type OpenLiveCollectionItemState,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';

/**
 * Opens the row a navigation asked for (`autoOpenItem`) once the list has
 * it. Must be called in an injection context.
 */
export function watchUnifiedLiveAutoOpen(deps: {
    readonly target: Signal<OpenLiveCollectionItemState | null>;
    readonly items: Signal<UnifiedCollectionItem[]>;
    readonly activeUid: Signal<string | null>;
    readonly activeItem: Signal<UnifiedCollectionItem | null>;
    readonly activeDetail: Signal<ResolvedLiveCollectionDetail | null>;
    readonly handled: () => void;
    readonly activate: (item: UnifiedCollectionItem) => void;
}): void {
    effect(() => {
        const target = deps.target();
        const items = deps.items();
        if (!target || items.length === 0) {
            return;
        }

        const matchedItem = items.find((item) =>
            matchesOpenLiveCollectionItem(item, target)
        );
        if (!matchedItem) {
            return;
        }

        // Handled only once the row is on screen: while it is merely the
        // pending highlight, `activeDetail` still belongs to the retained
        // stream, and `activate` folds this intent into the request in
        // flight instead of restarting it.
        if (
            deps.activeUid() === matchedItem.uid &&
            deps.activeItem()?.uid === matchedItem.uid &&
            deps.activeDetail()
        ) {
            deps.handled();
            return;
        }

        deps.activate(matchedItem);
    });
}
