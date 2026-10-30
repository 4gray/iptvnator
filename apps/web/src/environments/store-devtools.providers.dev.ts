import { EnvironmentProviders } from '@angular/core';
import { provideStoreDevtools } from '@ngrx/store-devtools';

// Swapped in for store-devtools.providers.ts by the development and
// electron-e2e build configurations only.
export const storeDevtoolsProviders: EnvironmentProviders[] = [
    provideStoreDevtools({ maxAge: 25 }),
];
