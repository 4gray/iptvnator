import { InjectionToken, type Signal, type TemplateRef } from '@angular/core';

/**
 * Context handed to the host's panel template.
 *
 * `searchTerm` is a signal rather than a string so the context object can stay
 * stable for the lifetime of the embedded view: `NgTemplateOutlet` keeps the
 * view (and with it the list's scroll position) as long as the template and
 * context identity do not change, and the host re-renders from the signal.
 */
export interface FullscreenChannelPanelContext {
    /** Raw text typed into the panel's search field; hosts normalize it. */
    readonly searchTerm: Signal<string>;
    /** Closes the panel, e.g. after the host handled a selection. */
    readonly close: () => void;
}

/**
 * Contract a live host provides under {@link FULLSCREEN_CHANNEL_PANEL} to
 * get a slide-in channel list inside the player's fullscreen surface.
 *
 * The provider is DI-gated on purpose: the panel component injects the token
 * optionally, so hosts without a channel list (VOD detail pages, series
 * playback) render no hot zone, handle or shortcut at all. The host decides
 * what goes into the panel and resolves the user preference itself by
 * returning `null` from `panelTemplate` when the feature is disabled.
 */
export interface FullscreenChannelPanelHost {
    /**
     * Template rendered inside the panel body. `null` disables the panel and
     * every affordance around it.
     */
    readonly panelTemplate: Signal<TemplateRef<FullscreenChannelPanelContext> | null>;
    /** Display-ready header title, e.g. the playlist or category name. */
    readonly panelTitle?: Signal<string>;
}

export const FULLSCREEN_CHANNEL_PANEL =
    new InjectionToken<FullscreenChannelPanelHost>('FULLSCREEN_CHANNEL_PANEL');
