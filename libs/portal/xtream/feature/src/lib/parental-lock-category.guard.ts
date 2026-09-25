import { inject } from '@angular/core';
import {
    ActivatedRouteSnapshot,
    CanActivateFn,
    Router,
    UrlTree,
} from '@angular/router';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { ParentalLockXtreamCategoryType } from '@iptvnator/shared/interfaces';

type XtreamCategorySection = 'live' | 'vod' | 'series';

const CATEGORY_TYPE_BY_SECTION: Record<
    XtreamCategorySection,
    ParentalLockXtreamCategoryType
> = {
    live: 'live',
    vod: 'movies',
    series: 'series',
};

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
 * Keeps a parental-locked Xtream category off the screen even when it is
 * reached by URL — a bookmark, a typed address or a stale in-app link — and
 * not through the (already filtered) category rail. The lock is keyed by the
 * provider category id; in Electron the route carries the SQLite row id, so
 * the guard maps it through the unfiltered category read (which only the
 * guard sees). Detail routes additionally check the ITEM's own category: a
 * locked movie paired with an unlocked category id in the URL is still a
 * locked movie. A locked target prompts for the PIN; a refusal redirects to
 * the section root instead of rendering the category or its detail.
 */
export function parentalLockXtreamCategoryGuard(
    section: XtreamCategorySection
): CanActivateFn {
    return async (route): Promise<boolean | UrlTree> => {
        const parentalLock = inject(ParentalLockService);
        const router = inject(Router);
        const databaseService = inject(DatabaseService);
        const runtime = inject(RuntimeCapabilitiesService);
        const dataSource = inject(XTREAM_DATA_SOURCE);

        await parentalLock.initialize();
        if (!parentalLock.active()) {
            return true;
        }

        const playlistId = findPlaylistId(route);
        if (!playlistId) {
            return true;
        }

        const categoryType = CATEGORY_TYPE_BY_SECTION[section];
        const rows = runtime.supportsXtreamSqliteDataSource
            ? await databaseService.getAllXtreamCategories(
                  playlistId,
                  categoryType
              )
            : null;
        // Electron routes and content rows carry SQLite category row ids;
        // the PWA carries provider ids everywhere.
        const toProviderId = (categoryId: number): number | null =>
            rows === null
                ? categoryId
                : (rows.find((candidate) => candidate.id === categoryId)
                      ?.xtream_id ?? null);
        const isLocked = (categoryId: number): boolean => {
            const xtreamId = toProviderId(categoryId);
            return (
                xtreamId !== null &&
                parentalLock.isXtreamCategoryLocked(
                    playlistId,
                    categoryType,
                    xtreamId
                )
            );
        };

        const routeCategoryId = Number(route.paramMap.get('categoryId'));
        let locked =
            Number.isFinite(routeCategoryId) && isLocked(routeCategoryId);

        const itemId = Number(
            route.paramMap.get('vodId') ?? route.paramMap.get('serialId')
        );
        if (!locked && section !== 'live' && Number.isFinite(itemId)) {
            const item = await dataSource.getContentByXtreamId(
                itemId,
                playlistId,
                section === 'vod' ? 'movie' : 'series'
            );
            const itemCategoryId = Number(item?.category_id);
            locked =
                Number.isFinite(itemCategoryId) && isLocked(itemCategoryId);
        }

        if (!locked || (await parentalLock.requestUnlock())) {
            return true;
        }
        return router.createUrlTree([
            '/workspace',
            'xtreams',
            playlistId,
            section,
        ]);
    };
}
