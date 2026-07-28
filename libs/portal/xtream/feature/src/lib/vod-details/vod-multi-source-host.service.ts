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
    runDiscovery,
    runFailover,
    switchToSource,
    type SwitchOutcome,
} from './vod-multi-source-session';
import type { VodMultiSourceSwitchNotice } from './vod-multi-source-notice';
import { currentSourceRow } from './vod-multi-source-current-row';
import { probeSource } from './vod-multi-source-probe';
import {
    pinnedSourceAwaitingPlay,
    pinnedSourceIdOf,
    playPinned,
    pinKeysFor,
    readPin,
    togglePinnedSource,
    type PinKeySets,
} from './vod-multi-source-pin';
import {
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
    private pinKeys: PinKeySets = { lookup: [], write: [] };
    /** Bumped per `load()`: discards a discovery the next one superseded. */
    private discoveryToken = 0;
    /** Bumped when the FILM changes; a rediscovery of the same one is a
     * refresh and must not cancel work in flight for it. */
    private sessionToken = 0;
    /** Bumped by every switch: a slower one must not overwrite a newer. */
    private switchToken = 0;
    private lastMovieKey: string | null = null;
    private movieIdentity: string | null = null;
    /** The row standing for the playlist the route is on. */
    private routeSourceId: string | null = null;
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
     * Alternative PLAYLISTS: the popover groups a playlist's copies under it,
     * so "also found in N other playlists" counts portals, not copies.
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
     * the tried-source set that makes failover terminate. The SAME film
     * arriving again is a refresh: enrichment changes the movie key on
     * purpose, but nothing about what is playing, and resetting would take the
     * film off the source the user switched to.
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
        this.pinKeys = pinKeysFor(movie);

        if (!this.discovery.isAvailable) {
            return;
        }

        const routeSource = currentSourceRow(movie);
        this.routeSourceId = routeSource.id;

        await runDiscovery({
            controller: this.controller,
            isCurrent: () => token === this.discoveryToken,
            readPin: () => readPin(this.pins, this.pinKeys.lookup),
            applyPin: (pin) => {
                this.controller.setPinnedSource(pinnedSourceIdOf(pin));
                // Where it was found is the only ambiguous key an unpin may
                // remove, being the row the user can actually see.
                this.pinKeys = { ...this.pinKeys, loaded: pin.matchKey };
            },
            discover: (keepContentId) =>
                this.discovery.discover({
                    title: movie.title,
                    year: movie.year,
                    currentPlaylistId: movie.playlistId,
                    keepContentId,
                }),
            routeSource,
            publish: () => this.publish(),
        });
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

        const session = this.sessionToken;
        return playPinned({
            controller: this.controller,
            pinnedSourceId: this.pendingPinnedSourceId(),
            resumeFor,
            isCurrent: () => session === this.sessionToken,
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
            // Only while this attempt still owns the spinner, or a slower
            // pick would clear the row that is still resolving.
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
            this.pinKeys,
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
     * Move to the best untried source after a playback failure. Null when
     * auto-failover is off or every source has been tried, and the caller
     * shows the honest error screen instead.
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

    /**
     * Hand the "playing" badge back to the route's own row, and retire a
     * switch still resolving — every caller is starting the route's stream,
     * so an older resolution would replace what the user just asked for.
     */
    markRouteSourceActive(): void {
        this.switchToken++;
        if (this.routeSourceId) {
            this.controller.setActiveSource(this.routeSourceId);
            this.publish();
        }
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
