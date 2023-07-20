import { getRouterSelectors } from '@ngrx/router-store';

export const {
    selectCurrentRoute,
    selectFragment,
    selectQueryParams,
    selectQueryParam,
    selectRouteParams,
    selectRouteParam,
    selectRouteData,
    selectRouteDataParam,
    selectUrl,
    selectTitle,
} = getRouterSelectors();
