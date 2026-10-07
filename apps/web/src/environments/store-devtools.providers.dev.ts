import { EnvironmentProviders } from '@angular/core';
import { provideStoreDevtools } from '@ngrx/store-devtools';

// Swapped in for store-devtools.providers.ts by the development,
// electron-e2e and electron-e2e-zoneless build configurations only.
export const storeDevtoolsProviders: EnvironmentProviders[] = [
    provideStoreDevtools({ maxAge: 25 }),
];
