import {
    afterNextRender,
    computed,
    inject,
    Injector,
    signal,
} from '@angular/core';
import {
    clearNavigationStateKeys,
    consumeStalkerReturnMarker,
    getOpenStalkerItemState,
    getStalkerReturnByHistoryState,
    getStalkerSimilarOrigin,
    isProviderOnlyDetailState,
    normalizeStalkerHandoffIdentity,
    OPEN_STALKER_ITEM_STATE_KEY,
    PROVIDER_ONLY_DETAIL_PRESENTATION_STATE_KEY,
    STALKER_SIMILAR_ORIGIN,
    type PortalCatalogFacade,
} from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';

function itemIdentity(
    item: Record<string, unknown> | null | undefined
): string {
    return normalizeStalkerHandoffIdentity(
        item?.['id'] ??
            item?.['series_id'] ??
            item?.['movie_id'] ??
            item?.['stream_id']
    );
}

export function createStalkerCatalogHandoff<T extends Record<string, unknown>>(
    catalog: PortalCatalogFacade<unknown, T, T>,
    host: HTMLElement
) {
    const injector = inject(Injector);
    const providerOnlyItemId = signal<string | null>(null);
    const detailInputs = computed<Record<string, unknown> | undefined>(() =>
        catalog.provider === 'stalker'
            ? {
                  providerOnly:
                      providerOnlyItemId() !== null &&
                      providerOnlyItemId() ===
                          itemIdentity(catalog.selectedItem()),
              }
            : undefined
    );

    function open(relatedEntry: boolean, restoreOrigin: boolean): void {
        if (catalog.provider !== 'stalker') return;
        const state = window.history.state;
        const section = catalog.contentType();
        const playlistId = catalog.playlist()?.id;
        const origin = restoreOrigin ? getStalkerSimilarOrigin(state) : null;
        const restored =
            origin &&
            !origin.search &&
            origin.catalog === section &&
            origin.playlistId === playlistId
                ? origin.item
                : null;
        const item = restored ?? getOpenStalkerItemState(state);
        if (!item) {
            // Browser Back can leave the marker on a consumed handoff. After
            // Forward, opening a title from the list must use the list's Back.
            if (
                !catalog.selectedItem() &&
                getStalkerReturnByHistoryState(state)
            ) {
                consumeStalkerReturnMarker();
            }
            return;
        }

        clearNavigationStateKeys([
            OPEN_STALKER_ITEM_STATE_KEY,
            'openFavoriteItem',
            'openRecentItem',
            PROVIDER_ONLY_DETAIL_PRESENTATION_STATE_KEY,
            ...(restored ? [STALKER_SIMILAR_ORIGIN] : []),
        ]);
        const category = item['category_id'];
        if (
            (restored || relatedEntry) &&
            playlistId &&
            (section === 'vod' || section === 'series') &&
            injector
                .get(ParentalLockService)
                .isStalkerCategoryLocked(
                    playlistId,
                    section,
                    typeof category === 'number' || typeof category === 'string'
                        ? category
                        : null
                )
        ) {
            consumeStalkerReturnMarker();
            return;
        }
        if (restored && origin?.catalogReturnId !== undefined) {
            catalog.restoreCatalogSimilarReturn?.(origin.catalogReturnId);
        }
        catalog.selectItem(item as T);
        catalog.refreshSnapshotSelection?.();
        providerOnlyItemId.set(
            isProviderOnlyDetailState(state) ? itemIdentity(item) || null : null
        );

        if (relatedEntry && !restored) {
            afterNextRender(
                () => {
                    const shell = host.querySelector<HTMLElement>(
                        'app-portal-detail-shell'
                    );
                    if (
                        !shell ||
                        itemIdentity(catalog.selectedItem()) !==
                            itemIdentity(item)
                    )
                        return;
                    shell.scrollTop = 0;
                    shell.focus({ preventScroll: true });
                },
                { injector }
            );
        }
    }

    return { detailInputs, open, reset: () => providerOnlyItemId.set(null) };
}
