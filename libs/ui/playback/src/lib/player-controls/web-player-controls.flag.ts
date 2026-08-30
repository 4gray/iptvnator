import { InjectionToken } from '@angular/core';

/**
 * Rollout switch for shared `app-player-controls` chrome on the web video
 * engines (HTML5+hls.js, Video.js, ArtPlayer).
 *
 * DEFAULT ON. Users opt back out via `Settings.webPlayerSharedControls`; the
 * built-in HTML5, Video.js, and ArtPlayer implementations consume the
 * injectable {@link WEB_PLAYER_SHARED_CONTROLS} token and switch atomically
 * between shared controls and their legacy vendor chrome.
 */
export const WEB_PLAYER_SHARED_CONTROLS_ENABLED = true;

/**
 * Injectable view of {@link WEB_PLAYER_SHARED_CONTROLS_ENABLED}. Components
 * inject this token; specs override it via TestBed providers without mocking a
 * module-level constant.
 */
export const WEB_PLAYER_SHARED_CONTROLS = new InjectionToken<boolean>(
    'WEB_PLAYER_SHARED_CONTROLS',
    {
        providedIn: 'root',
        factory: () => WEB_PLAYER_SHARED_CONTROLS_ENABLED,
    }
);
