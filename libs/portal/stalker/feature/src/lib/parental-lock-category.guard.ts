import { inject } from '@angular/core';
import {
    ActivatedRouteSnapshot,
    CanActivateFn,
    RedirectCommand,
    Router,
    UrlTree,
} from '@angular/router';
import { getOpenStalkerItemState } from '@iptvnator/portal/shared/util';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
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

/** Guard genre browsing while preserving direct item handoffs from collections and global search. */
export function parentalLockStalkerCategoryGuard(
    section: ParentalLockStalkerCategoryType
): CanActivateFn {
    return async (route): Promise<boolean | RedirectCommand | UrlTree> => {
        const parentalLock = inject(ParentalLockService);
        const router = inject(Router);

        const playlists = inject(PlaylistsService);
        const inventory = inject(PlaylistContextFacade);
        const navigationState = router.currentNavigation()?.extras.state;
        const playlistId = findPlaylistId(route);
        const categoryId = route.paramMap.get('categoryId');
        if (!playlistId || !categoryId) return true;
        const sectionRoot = ['/workspace', 'stalker', playlistId, section];
        const playlist =
            inventory.playlists().find((row) => row._id === playlistId) ??
            (await firstValueFrom(playlists.getPlaylistById(playlistId), {
                defaultValue: null,
            }));
        const hidden =
            categoryId !== '*' &&
            playlist?.hiddenStalkerCategories?.[section]?.includes(categoryId);
        if (hidden && !getOpenStalkerItemState(navigationState))
            return router.createUrlTree(sectionRoot);

        await parentalLock.initialize();
        if (
            parentalLock.active() &&
            parentalLock.isStalkerCategoryLocked(
                playlistId,
                section,
                categoryId
            ) &&
            !(await parentalLock.requestUnlock())
        )
            return router.createUrlTree(sectionRoot);

        // Show the requested detail over the visible All catalog. Keeping the
        // handoff and return marker lets Back take the original caller home.
        return hidden
            ? new RedirectCommand(
                  router.createUrlTree(sectionRoot, {
                      queryParams: route.queryParams,
                      fragment: route.fragment ?? undefined,
                  }),
                  { state: navigationState }
              )
            : true;
    };
}
