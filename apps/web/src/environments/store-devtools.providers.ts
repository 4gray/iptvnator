import { EnvironmentProviders } from '@angular/core';

// Every build ships without the NgRx store devtools. The development and
// electron-e2e configurations replace this file with
// store-devtools.providers.dev.ts, so @ngrx/store-devtools never enters the
// production, PWA or performance bundles.
export const storeDevtoolsProviders: EnvironmentProviders[] = [];
