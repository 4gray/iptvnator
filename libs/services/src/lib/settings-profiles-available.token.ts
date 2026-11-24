import { InjectionToken, signal, type Signal } from '@angular/core';

/**
 * Whether Settings → Profiles exists on this runtime: the profiles UI is on,
 * a source server is connected and it supports profiles. The app provides the
 * real answer; the default (off) keeps the section, its search rows and its
 * command palette entry out of every other host.
 */
export const SETTINGS_PROFILES_AVAILABLE = new InjectionToken<Signal<boolean>>(
    'SETTINGS_PROFILES_AVAILABLE',
    { providedIn: 'root', factory: () => signal(false).asReadonly() }
);
