import {
    computed,
    effect,
    inject,
    Injectable,
    signal,
    type Signal,
} from '@angular/core';
import {
    VodMultiSourceController,
    VodSourceDiscoveryService,
    VodSourceResolverService,
} from '@iptvnator/portal/shared/data-access';
import {
    SettingsStore,
    StreamProbeService,
    VodSourcePinService,
} from '@iptvnator/services';
import {
    vodMultiSourceMovieKey,
    vodMultiSourceSessionKey,
    type VodMultiSourceMovie,
} from './vod-multi-source-identity';
import {
    applyDiscoveredSources,
    runFailover,
    switchToSource,
    type SwitchOutcome,
} from './vod-multi-source-session';
import type { VodMultiSourceSwitchNotice } from './vod-multi-source-notice';
import { currentSourceRow } from './vod-multi-source-current-row';
import { probeSource } from './vod-multi-source-probe';
import {
    pinnedCopyInPlaylist,
    pinnedSourceAwaitingPlay,
    pinnedSourceIdOf,
    playPinned,
    readPin,
    togglePinnedSource,
} from './vod-multi-source-pin';
import {
    buildVodSourceMatchKeyCandidates,
    type ResolvedPortalPlayback,
    type VodSourceCandidate,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';

/**
 * Wires VOD multi-source into one open movie on the Xtream detail page.
 *
 * Component-provided, not root-provided: the controller's "each source is
 * tried at most once" set must die with the movie. The host supplies the
 * movie identity and the playback seam through `bind()`, so this never
 * reaches into the route component.
 */

export interface VodMultiSourceBindings {
    /** Applies a playback — inline swap or external launch, host's choice. */
    startPlayback: (playback: ResolvedPortalPlayback) => void;
    /** The movie on screen, or null while its identity is not yet knowable. */
    movie: Signal<VodMultiSourceMovie | null>;
}

export type { VodMultiSourceSwitchNotice };

@Injectable()
export class VodMultiSourceHostService {
    private readonly discovery = inject(VodSourceDiscoveryService);
    private readonly resolver = inject(VodSourceResolverService);
    private readonly pins = inject(VodSourcePinService);
    private readonly probes = inject(StreamProbeService);
    private readonly settingsStore = inject(SettingsStore);

    private controller = new VodMultiSourceController();
    private bindings: VodMultiSourceBindings | null = null;
    private matchKeys: string[] = [];
    /** Bumped per `load()`: discards a discovery the next one superseded. */
    private discoveryToken = 0;
    /**
     * Bumped when the FILM changes, and only then — a rediscovery of the same
     * film must not cancel a switch or probe in flight for it.
     */
    private sessionToken = 0;
    /**
     * Bumped by every switch, so a slower resolution cannot overwrite the
     * user's latest choice, nor the source Undo points back to.
     */
    private switchToken = 0;
    private lastMovieKey: string | null = null;
    private movieIdentity: string | null = null;
    /** Resolves once the discovery on the way has published its sources. */
    private loadInFlight: Promise<void> | null = null;

    /** True while `session`/`switch` still describe the operation in flight. */
    private isCurrentSwitch(session: number, attempt: number): boolean {
        return session === this.sessionToken && attempt === this.switchToken;
    }
    /** The source that was playing before the most recent switch. */
    private readonly _previousSourceId = signal<string | null>(null);

    private readonly _sources = signal<VodSourceDescriptor[]>([]);
    private readonly _busySourceId = signal<string | null>(null);
    /** Emitted after a switch so the host can toast it — never silent. */
    private readonly _lastSwitch = signal<VodMultiSourceSwitchNotice | null>(
        null
    );

    readonly sources = this._sources.asReadonly();
    readonly busySourceId = this._busySourceId.asReadonly();
    readonly lastSwitch = this._lastSwitch.asReadonly();
    readonly previousSourceId = this._previousSourceId.asReadonly();

    readonly alternatives = computed(() =>
        this._sources().filter((source) => !source.isActive)
    );
    /** The chip appears only when there is genuinely somewhere else to go. */
    readonly hasAlternatives = computed(() => this.alternatives().length > 0);
    /** Alternative STREAMS — what the "Sources N" chip counts. */
    readonly alternativeCount = computed(() => this.alternatives().length);
    /**
     * Alternative PLAYLISTS. The popover groups one playlist's three copies
     * under that playlist, so "also found in N other playlists" must count
     * portals, not copies, or it contradicts the list it opens.
     */
    readonly alternativePlaylistCount = computed(
        () => new Set(this.alternatives().map((s) => s.playlistId)).size
    );
    readonly matchKind = computed(() => this.controller.matchKind());

    /** Opt-in and off by default — a silent switch is never acceptable. */
    readonly autoFailoverEnabled = computed(
        () => this.settingsStore.vodAutoFailover?.() === true
    );

    /** Live getter: the bridge's own `isAvailable` can change under us. */
    get isAvailable(): boolean {
        return this.discovery.isAvailable;
    }

    /**
     * Wire the host's playback seam and watch the movie on screen. The effect
     * lives here because what it guards is this service's own lifecycle — see
     * `load()`.
     */
    bind(bindings: VodMultiSourceBindings): void {
        this.bindings = bindings;

        effect(() => {
            const movie = bindings.movie();
            if (!movie) {
                // Navigating away empties the identity before the next movie's
                // `load()` runs, so bumping here — not only there — closes the
                // window in which a resolution still in flight for the
                // PREVIOUS movie would start playing over the page being left.
                this.discoveryToken++;
                this.sessionToken++;
                return;
            }

            const key = vodMultiSourceMovieKey(movie);
            if (this.lastMovieKey === key) {
                return;
            }
            this.lastMovieKey = key;

            void this.load(movie);
        });
    }

    /**
     * (Re)discover the sources for a movie.
     *
     * A DIFFERENT film starts a fresh session — the router REUSES this
     * component for detail→detail navigation, so everything resets, above all
     * the tried-source set that makes failover terminate.
     *
     * The SAME film arriving again is a refresh, not a new session: enrichment
     * changes the movie key on purpose, but nothing about what is playing.
     * Resetting there would take the film off the source the user switched to
     * and hand failover a clean tried-set for sources it has already burned.
     */
    async load(movie: VodMultiSourceMovie): Promise<void> {
        const finished = this.discover(movie);
        this.loadInFlight = finished;
        try {
            await finished;
        } finally {
            if (this.loadInFlight === finished) {
                this.loadInFlight = null;
            }
        }
    }

    private async discover(movie: VodMultiSourceMovie): Promise<void> {
        const token = ++this.discoveryToken;
        const identity = vodMultiSourceSessionKey(movie);
        const sameMovie = identity === this.movieIdentity;
        this.movieIdentity = identity;

        if (!sameMovie) {
            this.sessionToken++;
            this.controller = new VodMultiSourceController();
            this._sources.set([]);
            this._lastSwitch.set(null);
            this._busySourceId.set(null);
            this._previousSourceId.set(null);
        }
        this.matchKeys = buildVodSourceMatchKeyCandidates(movie);

        if (!this.discovery.isAvailable) {
            return;
        }

        // Read FIRST, because discovery has to be told which copy to keep.
        const pin = await readPin(this.pins, this.matchKeys);
        if (token !== this.discoveryToken) {
            return;
        }

        const result = await this.discovery.discover({
            title: movie.title,
            year: movie.year,
            currentPlaylistId: movie.playlistId,
            keepContentId: pinnedCopyInPlaylist(pin, movie.playlistId),
        });
        if (token !== this.discoveryToken) {
            return;
        }

        applyDiscoveredSources(
            this.controller,
            currentSourceRow(movie),
            result.sources,
            result.matchKind
        );
        if (pin) {
            this.controller.setPinnedSource(pinnedSourceIdOf(pin));
        }

        this.publish();
    }

    /** The pinned source, when it is not the one the route already plays. */
    readonly pendingPinnedSourceId = computed(() =>
        pinnedSourceAwaitingPlay(this._sources())
    );

    /**
     * Start from the pinned source if there is one. Returns false when there is
     * nothing pinned to honour, leaving the caller's own Play path in charge.
     */
    async playPinnedSource(
        resumeFor?: (source: VodSourceCandidate) => Promise<number | null>
    ): Promise<boolean> {
        // The pin arrives with discovery; answering before the lookup lands
        // would make a persisted preference lose to worker latency.
        if (!(await this.stillOwnsScreen())) {
            return false;
        }

        return playPinned({
            controller: this.controller,
            pinnedSourceId: this.pendingPinnedSourceId(),
            resumeFor,
            play: (sourceId) => this.play(sourceId),
        });
    }

    /**
     * Wait for a discovery still in flight, then say whether this film is
     * still the one on screen. Both callers touch the controller afterwards,
     * and the user can navigate during the wait — acting then would answer
     * one film's question with another film's sources.
     */
    private async stillOwnsScreen(): Promise<boolean> {
        const session = this.sessionToken;
        await this.loadInFlight;
        return session === this.sessionToken;
    }

    /** Play from a specific source once; does not change the pin. */
    async play(sourceId: string): Promise<boolean> {
        const candidate = this.controller.findSource(sourceId);
        if (!candidate || !this.bindings) {
            return false;
        }

        this._busySourceId.set(sourceId);
        try {
            return (await this.switchTo(candidate)) === 'switched';
        } finally {
            // Only if this attempt still owns the spinner: a slower first pick
            // finishing after a second one would otherwise clear the row that
            // is still resolving.
            if (this._busySourceId() === sourceId) {
                this._busySourceId.set(null);
            }
        }
    }

    /** Pin or unpin this source as the movie's preferred one. */
    async togglePin(sourceId: string): Promise<void> {
        const session = this.sessionToken;
        const isPinned = this._sources().some(
            (source) => source.id === sourceId && source.isPinned
        );
        const pinned = await togglePinnedSource(
            this.pins,
            this.matchKeys,
            this.controller.findSource(sourceId),
            isPinned
        );

        // The write is an IPC round-trip, and another movie can own the screen
        // by the time it returns. Committing then would apply THIS film's
        // answer to THAT film's controller — an unpin would clear the pin it
        // just loaded, and its Play button would stop honouring it.
        if (pinned === undefined || session !== this.sessionToken) {
            return;
        }

        this.controller.setPinnedSource(pinned);
        this.publish();
    }

    /** User-triggered availability check for one row. */
    async check(sourceId: string): Promise<void> {
        await probeSource(sourceId, {
            controller: this.controller,
            resolver: this.resolver,
            probes: this.probes,
            isCurrent: (session) => session === this.sessionToken,
            session: this.sessionToken,
            publish: () => this.publish(),
        });
    }

    /**
     * Automatically move to the best untried source after a playback failure.
     *
     * Returns the notice to announce, or null when auto-failover is off or
     * every source has been tried — in which case the caller shows the honest
     * error screen instead.
     */
    async failover(): Promise<VodMultiSourceSwitchNotice | null> {
        if (!this.autoFailoverEnabled()) {
            return null;
        }

        // A stream can fail faster than the database answers. Concluding
        // "nowhere to go" against a controller whose discovery has not landed
        // yet would strand the user on the error screen with alternatives
        // arriving a moment later and nothing left to retry them.
        if (!(await this.stillOwnsScreen())) {
            return null;
        }

        const switched = await runFailover(this.controller, (candidate) =>
            this.switchTo(candidate)
        );
        return switched ? this._lastSwitch() : null;
    }

    /** The live position, fed ahead of the persist throttle. */
    reportPosition(seconds: number): void {
        this.controller.setResumeSeconds(seconds);
    }
    /** The stored position, standing in until the player reports its own. */
    seedResumePosition(seconds: number): void {
        this.controller.seedResumeSeconds(seconds);
    }

    private switchTo(candidate: VodSourceCandidate): Promise<SwitchOutcome> {
        const bindings = this.bindings;
        if (!bindings) {
            return Promise.resolve('superseded');
        }

        const session = this.sessionToken;
        const attempt = ++this.switchToken;

        return switchToSource(candidate, {
            controller: this.controller,
            resolve: (target, options) =>
                this.resolver.resolve(target, options),
            startPlayback: (playback) => bindings.startPlayback(playback),
            isCurrent: () => this.isCurrentSwitch(session, attempt),
            setPreviousSource: (id) => this._previousSourceId.set(id),
            setNotice: (notice) => this._lastSwitch.set(notice),
            publish: () => this.publish(),
        });
    }

    private publish(): void {
        this._sources.set(this.controller.sources());
    }
}
