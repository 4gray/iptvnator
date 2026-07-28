import { computed, signal } from '@angular/core';
import type {
    VodSourceCandidate,
    VodSourceDescriptor,
    VodSourceMatchKind,
    VodSourceProbeResult,
} from '@iptvnator/shared/interfaces';
import { factualOnly } from './vod-source-metadata.util';

/**
 * Per-movie multi-source session state.
 *
 * A plain class rather than a service: one instance belongs to one open movie,
 * mirroring `StalkerVodPlaybackController`. Holding this in a root-provided
 * service would leak `triedSourceIds` between films and quietly break the
 * anti-loop guarantee.
 *
 * It owns state and decisions only — no I/O. Discovery, resolution, probing
 * and persistence are injected by the host, which keeps this testable without
 * TestBed.
 */
export class VodMultiSourceController {
    private readonly _sources = signal<VodSourceCandidate[]>([]);
    private readonly _activeSourceId = signal<string | null>(null);
    private readonly _pinnedSourceId = signal<string | null>(null);
    private readonly _matchKind = signal<VodSourceMatchKind>('title-year');
    private readonly _probes = signal<Record<string, VodSourceProbeResult>>({});

    /**
     * Sources already attempted in this session.
     *
     * The anti-loop guarantee: failover only ever considers sources absent
     * from this set, so a three-source movie can fail over at most twice and
     * then honestly gives up. Never cleared during a session — only a fresh
     * movie (a new controller) resets it.
     */
    private readonly tried = new Set<string>();

    /** Live playback position, carried across a source switch. */
    private resumeSeconds = 0;

    readonly matchKind = this._matchKind.asReadonly();
    readonly activeSourceId = this._activeSourceId.asReadonly();

    /** Every known source, decorated with live session state. */
    readonly sources = computed<VodSourceDescriptor[]>(() => {
        const activeId = this._activeSourceId();
        const pinnedId = this._pinnedSourceId();
        const probes = this._probes();

        return this._sources().map((candidate) => ({
            ...candidate,
            isActive: candidate.id === activeId,
            isPinned: candidate.id === pinnedId,
            isTried: this.tried.has(candidate.id),
            probe: probes[candidate.id] ?? { status: 'idle' },
        }));
    });

    /** Sources other than the one playing — what the popover offers. */
    readonly alternatives = computed(() =>
        this.sources().filter((source) => !source.isActive)
    );

    /** The chip only appears when there is genuinely somewhere else to go. */
    readonly hasAlternatives = computed(() => this.alternatives().length > 0);

    readonly alternativeCount = computed(() => this.alternatives().length);

    setSources(sources: VodSourceCandidate[], matchKind: VodSourceMatchKind) {
        this._sources.set(sources);
        this._matchKind.set(matchKind);
    }

    /**
     * Merge an updated candidate (e.g. after resolution upgraded its metadata
     * from `parsed` to `api`) without disturbing list order or identity.
     */
    updateSource(updated: VodSourceCandidate) {
        this._sources.update((sources) =>
            sources.map((source) =>
                source.id === updated.id ? updated : source
            )
        );
    }

    /**
     * Select a source WITHOUT spending its failover turn.
     *
     * Discovery selects the route's row the moment the page opens, and a pin
     * or the picker can select an alternative before anything plays. None of
     * those is an attempt: counting them means a later failure finds the
     * route source "tried" and skips a perfectly healthy fallback — or calls
     * the options exhausted while one is untouched.
     */
    setActiveSource(sourceId: string | null) {
        this._activeSourceId.set(sourceId);
    }

    /** Select a source AND spend its turn — playback is actually starting. */
    markPlaying(sourceId: string) {
        this.markTried(sourceId);
        this.setActiveSource(sourceId);
    }

    /**
     * Record an attempt that never became active — e.g. a source whose URL
     * could not be resolved at all. Without this, failover would keep
     * re-picking a source that already proved unusable and spin.
     */
    markTried(sourceId: string) {
        this.tried.add(sourceId);
        // `tried` is not a signal (it is per-session bookkeeping, not state
        // the view derives from directly), so nudge the derived list.
        this._sources.update((sources) => [...sources]);
    }

    setPinnedSource(sourceId: string | null) {
        this._pinnedSourceId.set(sourceId);
    }

    setProbe(sourceId: string, result: VodSourceProbeResult) {
        this._probes.update((probes) => ({ ...probes, [sourceId]: result }));
    }

    /** Position updates arrive continuously from the player. */
    setResumeSeconds(seconds: number) {
        if (Number.isFinite(seconds) && seconds >= 0) {
            this.resumeSeconds = seconds;
        }
    }

    /**
     * Seed from the PERSISTED position, so a switch made before playback ever
     * started still resumes.
     *
     * Nothing reports a live position until the player emits its first
     * timeupdate, so until then this is zero — and "Resume" through a pinned
     * source would silently restart the film. Deliberately one-way: once a
     * live position exists it wins, because the stored one lags it by up to
     * the persistence throttle and applying it would visibly rewind.
     */
    seedResumeSeconds(seconds: number) {
        if (this.resumeSeconds <= 0) {
            this.setResumeSeconds(seconds);
        }
    }

    getResumeSeconds(): number {
        return this.resumeSeconds;
    }

    findSource(sourceId: string): VodSourceCandidate | null {
        return (
            this._sources().find((source) => source.id === sourceId) ?? null
        );
    }

    /**
     * The best source to fail over to, or null when the options are exhausted.
     *
     * Ranking deliberately ignores guessed metadata — a filename claiming 4K
     * must not outrank a source we actually reached. Order:
     *   1. never tried this session (a hard filter, not a preference)
     *   2. pinned by the user for this movie
     *   3. probed reachable
     *   4. not known to have failed recently
     *   5. richer FACTUAL metadata
     *   6. exact title match over fuzzy
     */
    pickFailoverTarget(): VodSourceDescriptor | null {
        const untried = this.sources().filter(
            (source) => !source.isActive && !source.isTried
        );
        if (untried.length === 0) {
            return null;
        }

        return [...untried].sort((a, b) => score(b) - score(a))[0];
    }

    /** True once every source has been attempted — time for an honest error. */
    isExhausted(): boolean {
        return this.pickFailoverTarget() === null;
    }
}

function score(source: VodSourceDescriptor): number {
    let value = 0;

    // An explicit user choice outranks anything we inferred about the others.
    if (source.isPinned) {
        value += 1000;
    }

    if (source.probe.status === 'ok') {
        value += 100;
    }
    if (source.probe.status === 'fail') {
        value -= 100;
    }
    if (source.lastFailedAt) {
        value -= 50;
    }
    if (source.matchConfidence === 'exact') {
        value += 10;
    }

    // Only verified metadata counts toward "richer". A parsed guess adds
    // nothing here by construction — factualOnly() cannot return one.
    const facts = factualOnly(source);
    value += [facts.quality, facts.codec, facts.container, facts.audio].filter(
        Boolean
    ).length;

    return value;
}
