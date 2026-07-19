import { InjectionToken, Signal, signal } from '@angular/core';
import type { SeriesResumeTarget } from '@iptvnator/portal/shared/util';

export const XTREAM_SERIES_RESUME_TARGET = new InjectionToken<
    Signal<SeriesResumeTarget | null>
>('XTREAM_SERIES_RESUME_TARGET', {
    factory: () => signal(null),
});
