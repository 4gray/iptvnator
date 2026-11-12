import type { XtreamStore } from '@iptvnator/portal/xtream/data-access';

export async function reloadStartupLiveCategory(
    store: InstanceType<typeof XtreamStore>,
    playlistId: string,
    previousCategoryId: number | null,
    isCurrent: () => boolean
): Promise<number | null> {
    const previousCategory = store
        .liveCategories()
        .find((category) => category.id === previousCategoryId);
    await store.reloadLiveCatalog(playlistId);
    if (
        !isCurrent() ||
        !previousCategory ||
        !('xtream_id' in previousCategory) ||
        store.selectedCategoryId() !== previousCategoryId
    ) {
        return store.selectedCategoryId();
    }
    const category = store
        .liveCategories()
        .find(
            (row) =>
                'xtream_id' in row &&
                row.xtream_id === previousCategory.xtream_id
        );
    const id = category?.id ?? null;
    store.setSelectedCategory(id);
    return id;
}
