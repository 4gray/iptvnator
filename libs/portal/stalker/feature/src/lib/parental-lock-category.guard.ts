import { inject } from '@angular/core';
import {
    ActivatedRouteSnapshot,
    CanActivateFn,
    Router,
    UrlTree,
} from '@angular/router';
import { ParentalLockService } from '@iptvnator/services';
import { ParentalLockStalkerCategoryType } from '@iptvnator/shared/interfaces';

function findPlaylistId(route: ActivatedRouteSnapshot): string | null {
    for (const snapshot of route.pathFromRoot) {
        const id = snapshot.paramMap.get('id');
        if (id) {
            return id;
        }
    }
    return null;
}

/**
 * Keeps a parental-locked Stalker genre off the screen when reached by URL.
 * Stalker routes carry the portal's own genre id, which is what the lock
 * store keys on, so no lookup is needed. A locked genre prompts for the PIN;
 * a refusal redirects to the section root.
 */
export function parentalLockStalkerCategoryGuard(
    section: ParentalLockStalkerCategoryType
): CanActivateFn {
    return async (route): Promise<boolean | UrlTree> => {
        const parentalLock = inject(ParentalLockService);
        const router = inject(Router);

        await parentalLock.initialize();
        if (!parentalLock.active()) {
            return true;
        }

        const playlistId = findPlaylistId(route);
        const categoryId = route.paramMap.get('categoryId');
        if (
            !playlistId ||
            !categoryId ||
            !parentalLock.isStalkerCategoryLocked(
                playlistId,
                section,
                categoryId
            )
        ) {
            return true;
        }
        if (await parentalLock.requestUnlock()) {
            return true;
        }
        return router.createUrlTree([
            '/workspace',
            'stalker',
            playlistId,
            section,
        ]);
    };
}
