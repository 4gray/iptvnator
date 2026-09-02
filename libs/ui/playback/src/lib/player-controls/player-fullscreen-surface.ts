import { InjectionToken } from '@angular/core';

/**
 * Element the shared controls send to DOM fullscreen instead of the engine's
 * own player root.
 *
 * `WebPlayerViewComponent` provides its host here. The engine component
 * underneath it is re-created for every source application (each channel or
 * episode switch mints a new application token), and removing the fullscreen
 * element from the DOM makes the browser leave fullscreen — so a fullscreen
 * owned by the engine root could never survive a channel change. The view
 * host outlives those remounts, and it also contains the fullscreen channel
 * panel and the playback diagnostic, which must stay visible in fullscreen.
 *
 * Hosts that render an engine without the view (specs, future embedders) do
 * not provide the token and keep the engine root as the fullscreen target.
 */
export interface PlayerFullscreenSurface {
    element(): HTMLElement | null;
}

export const PLAYER_FULLSCREEN_SURFACE =
    new InjectionToken<PlayerFullscreenSurface>('PLAYER_FULLSCREEN_SURFACE');
