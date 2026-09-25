import { inject } from '@angular/core';
import {
    ActivatedRouteSnapshot,
    CanActivateFn,
    Router,
    UrlTree,
} from '@angular/router';
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
 * guard sees). A locked category prompts for the PIN; a refusal redirects
 * to the section root instead of rendering the category or its detail.
 */
export function parentalLockXtreamCategoryGuard(
    section: XtreamCategorySection
): CanActivateFn {
    return async (route): Promise<boolean | UrlTree> => {
        const parentalLock = inject(ParentalLockService);
        const router = inject(Router);
        const databaseService = inject(DatabaseService);
        const runtime = inject(RuntimeCapabilitiesService);

        await parentalLock.initialize();
        if (!parentalLock.active()) {
            return true;
        }

        const playlistId = findPlaylistId(route);
        const rawCategoryId = Number(route.paramMap.get('categoryId'));
        if (!playlistId || !Number.isFinite(rawCategoryId)) {
            return true;
        }

        const categoryType = CATEGORY_TYPE_BY_SECTION[section];
        let xtreamId = rawCategoryId;
        if (runtime.supportsXtreamSqliteDataSource) {
            const rows = await databaseService.getAllXtreamCategories(
                playlistId,
                categoryType
            );
            const row = rows.find(
                (candidate) => candidate.id === rawCategoryId
            );
            if (!row) {
                return true;
            }
            xtreamId = row.xtream_id;
        }

        if (
            !parentalLock.isXtreamCategoryLocked(
                playlistId,
                categoryType,
                xtreamId
            )
        ) {
            return true;
        }
        if (await parentalLock.requestUnlock()) {
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
