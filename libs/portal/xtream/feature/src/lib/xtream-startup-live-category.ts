import type { XtreamStore } from '@iptvnator/portal/xtream/data-access';

export async function reloadStartupLiveCategory(
    store: InstanceType<typeof XtreamStore>,
    playlistId: string,
    routeCategoryId: number | null,
    isLiveSection: boolean,
    isCurrent: () => boolean
): Promise<number | null> {
    const previousCategories = store.liveCategories();
    const selectedId = isLiveSection ? store.selectedCategoryId() : null;
    await store.reloadLiveCatalog(playlistId);
    if (!isCurrent()) return routeCategoryId;

    const refreshedCategories = store.liveCategories();
    const remap = (id: number): number | null => {
        const previous = previousCategories.find((row) => row.id === id);
        if (!previous || !('xtream_id' in previous)) return null;
        return (
            refreshedCategories.find(
                (row) =>
                    'xtream_id' in row && row.xtream_id === previous.xtream_id
            )?.id ?? null
        );
    };
    if (selectedId !== null && store.selectedCategoryId() === selectedId) {
        store.setSelectedCategory(remap(selectedId));
    }
    return routeCategoryId === null ? null : remap(routeCategoryId);
}
