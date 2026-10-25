import type {
    ActivatedRouteSnapshot,
    NavigationExtras,
    Router,
} from '@angular/router';
import type { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import type { XtreamStore } from '@iptvnator/portal/xtream/data-access';

type ClearCategoryScopeOptions = {
    router: Router;
    playlistId: string;
    section: string | null;
    searchQuery: string;
} & (
    | {
          provider: 'xtreams';
          store: Pick<
              InstanceType<typeof XtreamStore>,
              'setSelectedCategory' | 'setSelectedItem'
          >;
      }
    | {
          provider: 'stalker';
          store: Pick<
              InstanceType<typeof StalkerStore>,
              'setSelectedCategory' | 'setPage' | 'clearSelectedItem'
          >;
      }
);

export function hasActiveLiveCategoryRoute(
    route: ActivatedRouteSnapshot
): boolean {
    if (route.url?.[0]?.path === 'live' && route.paramMap.has('categoryId')) {
        return true;
    }

    return route.children.some((child) => hasActiveLiveCategoryRoute(child));
}

export function clearCategoryScope(options: ClearCategoryScopeOptions): void {
    const { router, provider, store, playlistId, section, searchQuery } =
        options;
    const navigationExtras: NavigationExtras = {
        queryParamsHandling: 'merge',
        queryParams: { q: searchQuery.trim() || null },
    };
    if (provider === 'xtreams') {
        store.setSelectedCategory(null);
        if (section === 'vod' || section === 'series') {
            store.setSelectedItem(null);
        }
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
        store.setSelectedCategory('*');
        store.setPage(0);
        if (section === 'vod' || section === 'series') {
            store.clearSelectedItem();
            void router.navigate(
                ['/workspace', 'stalker', playlistId, section],
                navigationExtras
            );
        }
    }
}
