import type {
    ActivatedRouteSnapshot,
    NavigationExtras,
    Router,
} from '@angular/router';
import type { PortalProvider } from '@iptvnator/portal/shared/util';

export function hasActiveLiveCategoryRoute(
    route: ActivatedRouteSnapshot
): boolean {
    if (
        route.routeConfig?.path === 'live/:categoryId' &&
        route.paramMap.has('categoryId')
    ) {
        return true;
    }

    return route.children.some((child) => hasActiveLiveCategoryRoute(child));
}

export function navigateToCategoryCleared(options: {
    router: Router;
    provider: PortalProvider;
    playlistId: string;
    section: string | null;
    searchQuery: string;
}): void {
    const { router, provider, playlistId, section, searchQuery } = options;
    const navigationExtras: NavigationExtras = {
        queryParamsHandling: 'merge',
        queryParams: { q: searchQuery.trim() || null },
    };
    if (provider === 'xtreams') {
        if (section === 'live') {
            if (hasActiveLiveCategoryRoute(router.routerState.snapshot.root)) {
                void router.navigate(
                    ['/workspace', 'xtreams', playlistId, 'live'],
                    {
                        ...navigationExtras,
                        replaceUrl: true,
                    }
                );
            }
            return;
        }
        if (section === 'vod' || section === 'series') {
            void router.navigate(
                ['/workspace', 'xtreams', playlistId, section],
                navigationExtras
            );
        }
        return;
    }

    if (provider === 'stalker') {
        if (section === 'vod' || section === 'series') {
            void router.navigate(
                ['/workspace', 'stalker', playlistId, section],
                navigationExtras
            );
        }
    }
}
