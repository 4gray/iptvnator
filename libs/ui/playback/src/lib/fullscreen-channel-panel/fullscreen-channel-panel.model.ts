import { InjectionToken, type Signal, type TemplateRef } from '@angular/core';

/**
 * Context handed to the host's panel template.
 *
 * `searchTerm` and `open` are signals rather than plain values so the context
 * object can stay stable for the lifetime of the embedded view:
 * `NgTemplateOutlet` keeps the view (and with it the list's scroll position)
 * as long as the template and context identity do not change, and the host
 * re-renders from the signals.
 */
export interface FullscreenChannelPanelContext {
    /**
     * Raw text typed into the panel's search field; hosts normalize it. Stays
     * empty for a host that hides the field (`panelSearchEnabled` false).
     */
    readonly searchTerm: Signal<string>;
    /**
     * True while the panel is slid in. The body stays mounted between two
     * openings of one fullscreen session, so a host that wants to react to
     * the panel coming up (scroll the playing row into view) reads this
     * instead of its own init hook.
     */
    readonly open: Signal<boolean>;
    /** Closes the panel, e.g. after the host handled a selection. */
    readonly close: () => void;
}

/**
 * What the panel lists. Only changes the accessible names and the close
 * button's tooltip: "channel list" for the live hosts, "episode list" for
 * series playback. Every pointer and keyboard rule is the same for both.
 */
export type FullscreenPanelKind = 'channels' | 'episodes';

/**
 * Contract a host provides under {@link FULLSCREEN_CHANNEL_PANEL} to get a
 * slide-in side panel inside the player's fullscreen surface: a channel
 * list for live playback, an episode list for series playback.
 *
 * The provider is DI-gated on purpose: the panel component injects the token
 * optionally, so hosts without a list (VOD detail pages playing a movie)
 * render no hot zone, hint tab or shortcut at all. The host decides what
 * goes into the panel and resolves the user preference itself by returning
 * `null` from `panelTemplate` when the feature is disabled.
 */
export interface FullscreenChannelPanelHost {
    /**
     * Template rendered inside the panel body. `null` disables the panel and
     * every affordance around it.
     */
    readonly panelTemplate: Signal<TemplateRef<FullscreenChannelPanelContext> | null>;
    /**
     * Display-ready header title, e.g. the playlist, category or series
     * name. With the search field it becomes the field's placeholder
     * ("Search in <title>"); without it the header shows it as text.
     */
    readonly panelTitle?: Signal<string>;
    /**
     * Whether the header carries the search field (default true). A host
     * whose body has its own navigation (season tabs) turns it off; the
     * `C` key then lands focus on the panel itself instead of the field.
     */
    readonly panelSearchEnabled?: Signal<boolean>;
    /** Defaults to `'channels'`. */
    readonly panelKind?: FullscreenPanelKind;
}

export const FULLSCREEN_CHANNEL_PANEL =
    new InjectionToken<FullscreenChannelPanelHost>('FULLSCREEN_CHANNEL_PANEL');
