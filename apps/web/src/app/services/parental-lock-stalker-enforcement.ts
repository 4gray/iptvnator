import { Injector } from '@angular/core';
import { Router } from '@angular/router';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { toParentalLockStalkerCategoryType } from '@iptvnator/shared/interfaces';
import { STALKER_ROUTE } from './parental-lock-enforcement.service';

/**
 * The Stalker step of `ParentalLockEnforcementService`, in its own file so
 * the enforcement service can import it dynamically: a static import of the
 * Stalker store would put the whole Stalker data layer back on the initial
 * path (see docs/architecture/nx-workspace-boundaries.md).
 */
export function applyParentalLockToStalker(
    injector: Injector,
    parentalLock: ParentalLockService,
    router: Router
): void {
    const stalkerStore = injector.get(StalkerStore);
    const playlist = stalkerStore.currentPlaylist();
    const playlistId = playlist?._id;
    if (!playlistId) {
        return;
    }
    const contentType = toParentalLockStalkerCategoryType(
        stalkerStore.selectedContentType()
    );
    if (!contentType) {
        return;
    }
    const selectedCategoryId = stalkerStore.selectedCategoryId();
    const categoryWithheld =
        !!selectedCategoryId &&
        parentalLock.isStalkerCategoryLocked(
            playlistId,
            contentType,
            selectedCategoryId
        );
    // An item opened from "All" (`*`) or search has its own genre to be
    // judged by; the list dropping its row is not enough. Live and radio
    // rows carry that genre in `tv_genre_id`, VOD and series rows in
    // `category_id` (the store's withheld filter applies the same rule).
    const selectedItem = stalkerStore.selectedItem?.() as {
        category_id?: string | number;
        tv_genre_id?: string | number;
    } | null;
    const itemCategoryId =
        contentType === 'itv' || contentType === 'radio'
            ? selectedItem?.tv_genre_id
            : selectedItem?.category_id;
    const itemWithheld =
        !!selectedItem &&
        parentalLock.isStalkerCategoryLocked(
            playlistId,
            contentType,
            itemCategoryId
        );
    if (!categoryWithheld && !itemWithheld) {
        return;
    }
    stalkerStore.clearSelectedItem();
    if (categoryWithheld) {
        stalkerStore.setSelectedCategory(null);
    }
    const match = STALKER_ROUTE.exec(router.url);
    if (match && match[1] === playlistId) {
        void router.navigate(['/workspace', 'stalker', match[1], match[2]]);
    }
}
