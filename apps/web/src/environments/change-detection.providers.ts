import {
    EnvironmentProviders,
    provideZoneChangeDetection,
} from '@angular/core';

// Change detection for every build: zone.js schedules the ticks. The
// *-zoneless build configurations replace this file with
// change-detection.providers.zoneless.ts while plan item C6 measures
// zoneless change detection; see docs/architecture/zoneless-migration.md.
export const changeDetectionProviders: EnvironmentProviders[] = [
    provideZoneChangeDetection({ eventCoalescing: true }),
];
