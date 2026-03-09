import { InjectionToken, Type } from '@angular/core';

export const PORTAL_CATALOG_DETAIL_COMPONENT =
    new InjectionToken<Type<unknown> | null>('PORTAL_CATALOG_DETAIL_COMPONENT', {
        factory: () => null,
    });
