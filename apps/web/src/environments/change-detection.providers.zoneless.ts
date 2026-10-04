import {
    EnvironmentProviders,
    provideZonelessChangeDetection,
} from '@angular/core';

// Swapped in for change-detection.providers.ts by the *-zoneless build
// configurations only. zone.js stays in the polyfills until the flip, so
// Angular logs NG0914 in these builds; nothing patches through it.
export const changeDetectionProviders: EnvironmentProviders[] = [
    provideZonelessChangeDetection(),
];
