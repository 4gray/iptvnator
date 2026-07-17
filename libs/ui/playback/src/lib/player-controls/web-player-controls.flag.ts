import { InjectionToken } from '@angular/core';

/**
 * Reserved rollout switch for shared `app-player-controls` chrome on the web
 * video engines (HTML5+hls.js, Video.js, ArtPlayer).
 *
 * DEFAULT OFF. The built-in HTML5, Video.js, and ArtPlayer implementations
 * consume the injectable {@link WEB_PLAYER_SHARED_CONTROLS} token and switch
 * atomically between their existing chrome and shared controls.
 */
export const WEB_PLAYER_SHARED_CONTROLS_ENABLED = false;

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
