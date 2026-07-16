import { InjectionToken } from '@angular/core';

/**
 * Reserved rollout switch for shared `app-player-controls` chrome on the web
 * video engines (Video.js, html5+hls.js, ArtPlayer).
 *
 * DEFAULT OFF. #1148 adds no runtime consumer, so changing this constant alone
 * has no effect until a follow-up engine host reads the injectable
 * {@link WEB_PLAYER_SHARED_CONTROLS} token and performs the actual UI switch.
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
