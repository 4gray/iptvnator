import { InjectionToken, Signal } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';

/**
 * One row of the guide. `id` is the host's ROW id, unique within the current
 * scope (M3U: `<index>:<Channel.id>`, since playlist ids can repeat); it is
 * only ever handed back to the same host (`activate`, search hits).
 */
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
    readonly channels: readonly EpgGuideChannel[];
    readonly fromMs: number;
    readonly toMs: number;
}

export interface EpgGuideCatchUp {
    canWatch(channel: EpgGuideChannel, program: EpgProgram): boolean;
    watch(channel: EpgGuideChannel, program: EpgProgram): void;
}

/**
 * One programme search result. `channelId` is the matching row's
 * `EpgGuideChannel.id` when the host can resolve it (e.g. an exact `epgKey`
 * match) — `null` when the host cannot say which row the hit belongs to, in
 * which case the guide can show the hit but not jump to or highlight a row.
 */
export interface EpgGuideSearchHit {
    channelId: string | null;
    /** Display name for the hit's channel: the playlist row's when resolved, else the guide source's own (e.g. the XMLTV display name). */
    channelName?: string | null;
    program: EpgProgram;
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
    loadPrograms(range: EpgGuideWindow): Promise<Map<string, EpgProgram[]>>;
    /** Ids of channels with at least one programme in the window. */
    loadCoverage(range: EpgGuideWindow): Promise<Set<string>>;
    readonly activeChannelId: Signal<string | null>;
    /**
     * False while the host plays something other than the active channel's
     * live stream (catch-up/archive). The guide then lets the active row be
     * activated again, which is how the host returns to live.
     */
    readonly livePlayback?: Signal<boolean>;
    /** Switch playback; the guide stays open. */
    activate(channelId: string): void;
    /** Optional programme search; the toolbar hides its field when absent. */
    searchPrograms?(query: string): Promise<EpgGuideSearchHit[]>;
    readonly catchUp?: EpgGuideCatchUp;
}

export const EPG_GUIDE_SOURCE = new InjectionToken<EpgGuideSource>(
    'EPG_GUIDE_SOURCE'
);
