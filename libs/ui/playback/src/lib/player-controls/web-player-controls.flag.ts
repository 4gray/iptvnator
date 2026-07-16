import { InjectionToken } from '@angular/core';

/**
 * Reserved rollout switch for shared `app-player-controls` chrome on the web
 * video engines (Video.js, html5+hls.js, ArtPlayer).
 *
 * DEFAULT OFF. The built-in HTML5 player consumes the injectable
 * {@link WEB_PLAYER_SHARED_CONTROLS} token and switches atomically between its
 * native chrome and shared controls. Video.js and ArtPlayer do not consume the
 * token yet.
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
