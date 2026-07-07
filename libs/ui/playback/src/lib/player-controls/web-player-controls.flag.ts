import { InjectionToken } from '@angular/core';

/**
 * Master rollout switch for the shared `app-player-controls` chrome on the web
 * video engines (Video.js, html5+hls.js, ArtPlayer).
 *
 * DEFAULT OFF: each web player keeps its original built-in skin and behaves
 * exactly as before. Flip to `true` to disable the per-engine skins and render
 * the shared controls over the `<video>` element instead. Kept as a const so the
 * default is statically obvious; consumers read it through the injectable
 * {@link WEB_PLAYER_SHARED_CONTROLS} token so tests can override it.
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
