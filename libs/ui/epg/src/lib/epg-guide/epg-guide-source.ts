import { InjectionToken, Signal } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';

/** One row of the guide. `id` is host-stable (M3U: `Channel.id`). */
export interface EpgGuideChannel {
    id: string;
    /** 1-based position inside the current scope; shown in the channel cell. */
    number: number;
    name: string;
    logoUrl: string | null;
    /**
     * Programme lookup key (M3U: tvg-id, else tvg-name, else name). `null`
     * means the host already knows there is no EPG binding, so the guide
     * renders "no programme information" without asking.
     */
    epgKey: string | null;
}

export type EpgGuideScopeKind = 'all' | 'group' | 'favorites';

export interface EpgGuideScope {
    id: string;
    label: string;
    kind: EpgGuideScopeKind;
}

/** A request window. Instants are provider-clock ms (display offset removed). */
export interface EpgGuideWindow {
    channels: EpgGuideChannel[];
    fromMs: number;
    toMs: number;
}

export interface EpgGuideCatchUp {
    canWatch(channel: EpgGuideChannel, program: EpgProgram): boolean;
    watch(channel: EpgGuideChannel, program: EpgProgram): void;
}

/**
 * Everything the guide needs from its host. The host owns scope state,
 * playback and the player; the guide owns rendering, caching and keyboard
 * navigation. Portal hosts implement the same contract with their own EPG
 * feeds (sub-project 2).
 */
export interface EpgGuideSource {
    /** Scope-resolved channels in playlist order (radio/movies excluded by host). */
    readonly channels: Signal<EpgGuideChannel[]>;
    readonly scopes: Signal<EpgGuideScope[]>;
    readonly scopeId: Signal<string>;
    setScope(id: string): void;
    /** Programmes overlapping the window, keyed by `EpgGuideChannel.id`. */
    loadPrograms(window: EpgGuideWindow): Promise<Map<string, EpgProgram[]>>;
    /** Ids of channels with at least one programme in the window. */
    loadCoverage(window: EpgGuideWindow): Promise<Set<string>>;
    readonly activeChannelId: Signal<string | null>;
    /** Switch playback; the guide stays open. */
    activate(channelId: string): void;
    /** Optional programme search; the toolbar hides its field when absent. */
    searchPrograms?(query: string): Promise<EpgProgram[]>;
    readonly catchUp?: EpgGuideCatchUp;
}

export const EPG_GUIDE_SOURCE = new InjectionToken<EpgGuideSource>(
    'EPG_GUIDE_SOURCE'
);
