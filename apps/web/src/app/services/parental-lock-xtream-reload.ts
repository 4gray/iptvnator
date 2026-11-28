import type { EnvironmentInjector } from '@angular/core';
import { Router } from '@angular/router';
import {
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    ParentalLockService,
    SourceActivityService,
} from '@iptvnator/services';
import { toParentalLockXtreamCategoryType } from '@iptvnator/shared/interfaces';

export async function reloadXtreamCatalogAfterLock(
    injector: EnvironmentInjector,
    playlistId: string,
    version: number,
    matchRoute: (url: string) => RegExpExecArray | null
): Promise<void> {
    const parentalLock = injector.get(ParentalLockService);
    const xtreamStore = injector.get(XtreamStore);
    const sourceActivity = injector.get(SourceActivityService);
    const router = injector.get(Router);
    // A playlist switch retires the apply as a newer lock version
    // does: the store now holds another portal, whose own load reads
    // under the current lock state.
    const shouldPublish = (): boolean =>
        parentalLock.version() === version &&
        xtreamStore.playlistId?.() === playlistId;
    // An Electron cache miss can write categories. Keep the lock reload
    // from refilling the catalog while startup is preserving SQLite IDs.
    await sourceActivity.runWhenIdle(playlistId, async () => {
        if (!shouldPublish()) return;
        await xtreamStore.reloadCategories(shouldPublish);
        if (!shouldPublish()) return;
        await xtreamStore.reloadCachedContent(shouldPublish);
        if (!shouldPublish()) return;
        // Stored in-portal search results must also be read under the new lock.
        await xtreamStore.refreshSearchResults?.();
        if (shouldPublish() && parentalLock.active())
            await stepOffWithheldXtreamSelection();
    });

    // Use the unfiltered category rows: a category hidden by the owner
    // need not be PIN-locked. An unreadable category fails closed.
    async function stepOffWithheldXtreamSelection(): Promise<void> {
        const match = matchRoute(router.url);
        const categoryType = toParentalLockXtreamCategoryType(match?.[2]);
        if (!categoryType) {
            return;
        }
        const rows = await injector
            .get(XTREAM_DATA_SOURCE)
            .getAllCategories(playlistId, categoryType)
            .catch(() => null);
        if (!shouldPublish()) {
            return;
        }
        const isWithheld = (categoryId: unknown): boolean => {
            const id = Number(categoryId);
            if (
                categoryId === null ||
                categoryId === undefined ||
                !Number.isFinite(id)
            ) {
                return false;
            }
            const row = rows?.find((candidate) => candidate.id === id);
            return (
                !row ||
                parentalLock.isXtreamCategoryLocked(
                    playlistId,
                    categoryType,
                    row.xtream_id
                )
            );
        };
        const selectedItem = xtreamStore.selectedItem?.() as {
            category_id?: string | number;
        } | null;
        const itemWithheld = isWithheld(selectedItem?.category_id);
        const categoryWithheld = isWithheld(xtreamStore.selectedCategoryId());
        if (!itemWithheld && !categoryWithheld) {
            return;
        }
        xtreamStore.setSelectedItem(null);
        if (categoryWithheld) {
            xtreamStore.setSelectedCategory(null);
        }
        if (match && match[1] === playlistId) {
            void router.navigate(['/workspace', 'xtreams', match[1], match[2]]);
        }
    }
}
