import { computed } from '@angular/core';
import { PortalCatalogFacade } from '@iptvnator/portal/shared/util';
import { createCatalogWatchFilter } from './catalog-watch-filter';
import { createCatalogHideWatched } from './catalog-hide-watched';

/** Translation keys keep the catalog count reactive to language changes. */
export function createCatalogItemSubtitle<C, I, S>(
    catalog: PortalCatalogFacade<C, I, S>,
    watchFilter: ReturnType<typeof createCatalogWatchFilter>,
    hideWatched: ReturnType<typeof createCatalogHideWatched>
) {
    return computed(() => {
        if (catalog.contentError?.())
            return { key: 'PORTALS.CATALOG_LOAD_ERROR.TITLE', params: {} };
        if (watchFilter.blocked())
            return {
                key: watchFilter.error()
                    ? 'WORKSPACE.REFINE_WATCH_ERROR_TITLE'
                    : 'WORKSPACE.REFINE_WATCH_LOADING',
                params: {},
            };
        if (catalog.isPaginatedContentLoading())
            return { key: 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING', params: {} };
        const count = catalog.categoryItemCount();
        if (hideWatched.active())
            return {
                key: 'WORKSPACE.REFINE_HIDE_WATCHED_COUNT',
                params: {
                    shown: catalog.paginatedContent()?.length ?? 0,
                    count,
                },
            };
        return {
            key:
                count === 1
                    ? 'WORKSPACE.CONTEXT.ITEM_COUNT_ONE'
                    : 'WORKSPACE.CONTEXT.ITEM_COUNT_OTHER',
            params: { count },
        };
    });
}
