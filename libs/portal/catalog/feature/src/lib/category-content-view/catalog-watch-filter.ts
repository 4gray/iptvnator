import { afterNextRender, computed, inject, Injector } from '@angular/core';
import {
    PortalCatalogFacade,
    PortalWatchStateFilter,
} from '@iptvnator/portal/shared/util';
import { CATALOG_WATCH_FILTER_OPTIONS } from './catalog-watch-filter-options';

/** View state for the optional movie refinement, independent of provider. */
export function createCatalogWatchFilter<C, I, S>(
    catalog: PortalCatalogFacade<C, I, S>,
    host: HTMLElement
) {
    const injector = inject(Injector);
    const canFilter = computed(
        () =>
            catalog.contentType() === 'vod' &&
            catalog.supportsWatchStateFilter === true &&
            typeof catalog.setWatchStateFilter === 'function'
    );
    const value = computed(() =>
        canFilter() ? (catalog.watchStateFilter?.() ?? null) : null
    );
    const active = computed(() => value() !== null);
    const loadState = computed(() =>
        active() ? (catalog.watchFilterLoadState?.() ?? 'idle') : 'ready'
    );
    const pending = computed(
        () => loadState() === 'idle' || loadState() === 'loading'
    );
    const error = computed(() => loadState() === 'error');
    const blocked = computed(() => pending() || error());
    const empty = computed(
        () =>
            active() &&
            !blocked() &&
            !catalog.isPaginatedContentLoading() &&
            catalog.categoryItemCount() === 0
    );
    const labelKey = computed(
        () =>
            CATALOG_WATCH_FILTER_OPTIONS.find(
                (option) => option.value === value()
            )?.labelKey ?? 'WORKSPACE.REFINE_WATCH_ALL'
    );
    return {
        canFilter,
        value,
        active,
        pending,
        error,
        blocked,
        empty,
        labelKey,
        options: CATALOG_WATCH_FILTER_OPTIONS,
        set(value: PortalWatchStateFilter): void {
            if (!canFilter()) return;
            const focusedClear = host.ownerDocument.activeElement?.closest(
                '.watch-refinement-chip, .watch-filter-clear'
            );
            catalog.setWatchStateFilter?.(value);
            if (value === null && focusedClear && host.contains(focusedClear)) {
                afterNextRender(
                    () =>
                        host
                            .querySelector<HTMLButtonElement>('.refine-action')
                            ?.focus(),
                    { injector }
                );
            }
        },
        retry(): void {
            if (canFilter()) catalog.retryWatchFilterPositions?.();
        },
    };
}
