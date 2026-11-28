import type { Location } from '@angular/common';
import type { Router } from '@angular/router';
import type { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import type { XtreamStartupRefreshService } from '@iptvnator/services/xtream-startup-refresh';
import {
    getRoutePath,
    getXtreamRouteCategoryId,
} from './xtream-route-playlist';

export async function reloadStartupLiveSelection(
    store: InstanceType<typeof XtreamStore>,
    playlistId: string
): Promise<void> {
    const previousCategories = store.liveCategories();
    const previousStreams = store.liveStreams();
    if (!(await store.reloadLiveCatalog(playlistId))) return;

    if (store.selectedContentType() !== 'live') return;
    const selectedId = store.selectedCategoryId();
    if (
        selectedId !== null &&
        previousCategories.some((row) => row.id === selectedId) &&
        !store.liveCategories().some((row) => row.id === selectedId)
    ) {
        store.setSelectedCategory(null);
    }

    const selected = store.selectedItem();
    const providerId = selected?.xtream_id;
    if (
        !selected ||
        !providerId ||
        (selected['type'] != null && selected['type'] !== 'live') ||
        !previousStreams.some(
            (row) =>
                row.xtream_id === providerId &&
                Number(row.category_id) === Number(selected.category_id)
        )
    )
        return;

    const candidates = store
        .liveStreams()
        .filter((row) => row.xtream_id === providerId);
    const preferredCategory = Number(selected.category_id);
    const refreshed =
        candidates.find(
            (row) => Number(row.category_id) === preferredCategory
        ) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (refreshed) {
        store.setSelectedItem({ ...selected, ...refreshed });
    }
}

export async function replaceStartupLiveCategoryUrl(
    refresh: XtreamStartupRefreshService,
    router: Router,
    location: Location,
    playlistId: string,
    updateDate: number,
    isCurrent: () => boolean
): Promise<'changed' | 'deferred' | 'unchanged'> {
    const url = router.url;
    const categoryId = getXtreamRouteCategoryId(url, 'live');
    if (
        categoryId === null ||
        !refresh.wasLiveCategoryRemoved(playlistId, updateDate, categoryId)
    )
        return 'unchanged';

    // The router clears currentNavigation after publishing its terminal event.
    await Promise.resolve();
    if (!isCurrent()) return 'changed';
    if (router.currentNavigation()) return 'deferred';

    const path = getRoutePath(url);
    const liveRoot = path.slice(0, path.lastIndexOf('/'));
    return (await router.navigateByUrl(liveRoot + url.slice(path.length), {
        replaceUrl: true,
        state: location.getState() as Record<string, unknown>,
    }))
        ? 'changed'
        : 'unchanged';
}
