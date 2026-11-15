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

    const refreshedCategories = store.liveCategories();
    const remap = (id: number): number | undefined => {
        const previous = previousCategories.find((row) => row.id === id);
        if (!previous || !('xtream_id' in previous)) return undefined;
        return refreshedCategories.find(
            (row) => 'xtream_id' in row && row.xtream_id === previous.xtream_id
        )?.id;
    };

    if (store.selectedContentType() !== 'live') return;
    const selectedId = store.selectedCategoryId();
    if (
        selectedId !== null &&
        previousCategories.some((row) => row.id === selectedId)
    ) {
        store.setSelectedCategory(remap(selectedId) ?? null);
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
    const preferredCategory = remap(Number(selected.category_id));
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
    if (categoryId === null) return 'unchanged';
    const replacement = await refresh.resolvePreviousCategory(
        playlistId,
        updateDate,
        categoryId
    );
    if (!isCurrent()) return 'changed';
    if (replacement === undefined || replacement === categoryId)
        return 'unchanged';
    if (router.currentNavigation()) return 'deferred';

    const path = getRoutePath(url);
    const liveRoot = path.slice(0, path.lastIndexOf('/'));
    const newPath =
        replacement === null ? liveRoot : `${liveRoot}/${replacement}`;
    return (await router.navigateByUrl(newPath + url.slice(path.length), {
        replaceUrl: true,
        state: location.getState() as Record<string, unknown>,
    }))
        ? 'changed'
        : 'unchanged';
}
