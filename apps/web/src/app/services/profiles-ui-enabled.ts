import { InjectionToken } from '@angular/core';

/**
 * While false no profiles UI shows and the start-up guard never routes to the
 * picker. Tests and E2E flip the token, never this file. PR B (per-profile
 * client state, #2224) removes this constant and the token.
 */
export const PROFILES_UI_ENABLED = false;
export const PROFILES_UI_ENABLED_TOKEN = new InjectionToken<boolean>(
    'PROFILES_UI_ENABLED',
    { providedIn: 'root', factory: () => PROFILES_UI_ENABLED }
);
