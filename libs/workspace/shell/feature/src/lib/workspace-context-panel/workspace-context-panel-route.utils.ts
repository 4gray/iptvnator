import type { ActivatedRouteSnapshot } from '@angular/router';

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
