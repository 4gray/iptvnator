import {
    computed,
    effect,
    inject,
    Injectable,
    signal,
    type Signal,
} from '@angular/core';
import {
    applyApiMetadata,
    VodMultiSourceController,
    VodSourceDiscoveryService,
    VodSourceProbeCacheService,
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
    toPinnedOutcome,
    switchToSource,
    type SwitchOutcome,
} from './vod-multi-source-session';
import type { VodMultiSourceSwitchNotice } from './vod-multi-source-notice';
import { createVodSourceCounts } from './vod-multi-source-counts';
import { createCheckQueue } from './vod-multi-source-check-queue';
import { currentSourceRow } from './vod-multi-source-current-row';
import { probeSource } from './vod-multi-source-probe';
import {
    pinnedSourceAwaitingPlay,
    type PinnedPlayOutcome,
    pinnedSourceIdOf,
    startPinnedSource,
    pinKeysFor,
    readPin,
    commitPinToggle,
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
    /**
     * Applies a playback — inline swap or external launch, host's choice.
     * False leaves the controller on its current source.
     */
    startPlayback: (
        playback: ResolvedPortalPlayback,
        isCurrent: () => boolean
    ) => Promise<boolean>;
    /** The movie on screen, or null while its identity is not yet knowable. */
    movie: Signal<VodMultiSourceMovie | null>;
    /**
     * Whether a stream is on screen right now — NOT whether a row is selected.
     * A pinned row stays selected after its player is closed.
     */
    playbackLive: Signal<boolean>;
    /**
     * True while an external launch has no exact closer yet. A source pick in
     * that interval cannot safely replace the launch and must not supersede
     * the switch token that still owns it.
     */
    playbackStartBlocked: Signal<boolean>;
}

export type { VodMultiSourceSwitchNotice };

@Injectable()
export class VodMultiSourceHostService {
    private readonly discovery = inject(VodSourceDiscoveryService);
    private readonly resolver = inject(VodSourceResolverService);
    private readonly pins = inject(VodSourcePinService);
    private readonly probes = inject(StreamProbeService);
    private readonly probeCache = inject(VodSourceProbeCacheService);
    private readonly settingsStore = inject(SettingsStore);

    /**
     * At most this many availability checks in flight at once. Each check is
     * a live `get_vod_info` plus a HEAD against a foreign portal, and "check
     * all" would otherwise burst one connection per playlist the movie is in.
     */
    private readonly checkQueue = createCheckQueue(4);

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
    /** The provider facts already overlaid on that row, to overlay each once. */
    private routeFactsKey: string | null = null;
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

    private readonly counts = createVodSourceCounts(this._sources);
    readonly alternatives = this.counts.alternatives;
    readonly hasAlternatives = this.counts.hasAlternatives;
    readonly alternativeCount = this.counts.alternativeCount;
    readonly alternativePlaylistCount = this.counts.alternativePlaylistCount;
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
                // Same film, described the same way — but `get_vod_info` can
                // land without touching title, year or TMDB id while adding
                // the provider's facts about the stream. Rediscovery would be
                // wasted work; only the route's own row is missing anything.
                this.refreshRouteFacts(movie);
                return;
            }
            this.lastMovieKey = key;
            this.routeFactsKey = null;

            void this.load(movie);
        });
    }

    /**
     * Overlay the provider's facts onto the route's own row, in place.
     *
     * The row is built when discovery runs, which on a sparse panel happens
     * before `get_vod_info` answers — and if that answer adds no year and no
     * TMDB id, the movie key does not change, so nothing rebuilds the row and
     * it keeps stating nothing. Every comparison against it is then one-sided:
     * the dub warning in particular cannot fire at all.
     *
     * Merged onto the existing row rather than rebuilt from the movie, so a
     * probe result already sitting on it survives.
     */
    private refreshRouteFacts(movie: VodMultiSourceMovie): void {
        const facts = movie.metadata;
        const routeSourceId = this.routeSourceId;
        if (!facts || !routeSourceId) {
            return;
        }

        const factsKey = JSON.stringify(facts);
        if (this.routeFactsKey === factsKey) {
            return;
        }

        const existing = this.controller.findSource(routeSourceId);
        if (!existing) {
            return;
        }

        this.routeFactsKey = factsKey;
        this.controller.updateSource(applyApiMetadata(existing, facts));
        this.publish();
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

        if (token === this.discoveryToken) {
            this.seedCachedProbes();
        }
    }

    /**
     * Overlay remembered verdicts onto freshly discovered rows.
     *
     * The controller starts every row at `idle`, but a check made minutes ago
     * — on this page or before navigating away — is still a usable answer.
     * Only untouched rows are seeded: a verdict the session already holds is
     * at least as fresh as the cache's.
     */
    private seedCachedProbes(): void {
        let seeded = false;
        for (const source of this.controller.sources()) {
            if (source.probe.status !== 'idle') {
                continue;
            }

            const cached = this.probeCache.get(source.id);
            if (cached) {
                this.controller.setProbe(source.id, cached);
                seeded = true;
            }
        }

        if (seeded) {
            this.publish();
        }
    }

    /** The pinned source, when it is not the one the route already plays. */
    readonly pendingPinnedSourceId = computed(() =>
        pinnedSourceAwaitingPlay(
            this._sources(),
            this.bindings?.playbackLive() === true
        )
    );

    /**
     * Start from the pinned source if there is one. `unavailable` means there
     * is nothing pinned to honour, leaving the caller's own Play path in
     * charge; a superseded attempt must NOT fall through that way.
     */
    playPinnedSource(
        resumeFor?: (source: VodSourceCandidate) => Promise<number | null>
    ): Promise<PinnedPlayOutcome> {
        const session = this.sessionToken;
        // Claim a switch generation up front. The discovery wait and the
        // resume lookup are both awaits, and a source the user picks across
        // either one has to win — otherwise this older attempt finishes last
        // and replaces what they just chose.
        const attempt = ++this.switchToken;
        return startPinnedSource({
            controller: this.controller,
            loadInFlight: this.loadInFlight,
            pinnedSourceId: () => this.pendingPinnedSourceId(),
            resumeFor,
            isCurrent: () => this.isCurrentSwitch(session, attempt),
            play: (sourceId) => this.runPlay(sourceId),
        });
    }

    /** Play from a specific source once; does not change the pin. */
    async play(sourceId: string): Promise<boolean> {
        return (await this.runPlay(sourceId)) === 'played';
    }

    /** As `play`, but keeping the distinction the pinned path needs. */
    private async runPlay(sourceId: string): Promise<PinnedPlayOutcome> {
        const candidate = this.controller.findSource(sourceId);
        if (!candidate || !this.bindings) {
            return 'unavailable';
        }

        this._busySourceId.set(sourceId);
        try {
            return toPinnedOutcome(await this.switchTo(candidate));
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
        const pinned = await commitPinToggle({
            pins: this.pins,
            keys: this.pinKeys,
            candidate: this.controller.findSource(sourceId),
            isPinned: this._sources().some(
                (source) => source.id === sourceId && source.isPinned
            ),
            isCurrent: () => session === this.sessionToken,
        });

        if (pinned === undefined) {
            return;
        }

        this.controller.setPinnedSource(pinned);
        this.publish();
    }

    /**
     * User-triggered availability check for one row.
     *
     * Gated through the check queue so "check all" cannot burst a connection
     * per playlist; a row already probing (or queued — its status flips to
     * `probing` before the queue admits it) is not enqueued twice.
     */
    check(sourceId: string): Promise<void> {
        const current = this._sources().find(
            (source) => source.id === sourceId
        );
        if (!current || current.probe.status === 'probing') {
            return Promise.resolve();
        }

        // Marked before queueing, not inside the task: the row must show
        // "checking" the moment the user asks, even while it waits for a slot
        // — and the guard above reads this same status to dedupe.
        this.controller.setProbe(sourceId, { status: 'probing' });
        this.publish();

        // Bound to the session that ASKED for the check, not to whatever is
        // current when a slot frees up. "Check all" can leave a dozen tasks
        // waiting, and the user is free to open another movie meanwhile —
        // those tasks are then about a film that is no longer on screen, so
        // they are dropped before spending a resolve on a foreign portal.
        // Both the controller and the session are read when a slot frees up,
        // NOT captured here — and that is deliberate.
        //
        // Capturing them would look safer and is worse: `sessionToken` also
        // moves when the movie identity is momentarily null, and that path
        // does NOT replace the controller (only a different film does). A
        // task dropped on a stale captured token would therefore abandon a
        // row it had already marked `probing` in the controller still on
        // screen, leaving it spinning for good.
        //
        // Read late, a queued task simply asks the CURRENT controller for the
        // source: gone when the user moved to another film, so `probeSource`
        // returns before it spends a request, and present when they came back
        // to the same one, where finishing the check is exactly right.
        return this.checkQueue(() =>
            probeSource(sourceId, {
                controller: this.controller,
                resolver: this.resolver,
                probes: this.probes,
                isCurrent: (session) => session === this.sessionToken,
                session: this.sessionToken,
                publish: () => this.publish(),
                cacheResult: (id, result) => this.probeCache.store(id, result),
            })
        );
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
        //
        // The switch generation is claimed up front and rechecked after, as
        // the pinned path does. The session alone is not enough: it only
        // changes when the FILM does, and the user can pick another source —
        // or restart the route's own — across this wait. Failover would then
        // treat what they just started as the stream that failed and switch
        // away from it.
        const session = this.sessionToken;
        const attempt = ++this.switchToken;
        await this.loadInFlight;
        if (!this.isCurrentSwitch(session, attempt)) {
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
        this.supersedePendingSwitch();
        if (this.routeSourceId) {
            this.controller.markPlaying(this.routeSourceId);
            this.publish();
        }
    }

    /** Cancel an older source resolution without claiming that route playback started. */
    supersedePendingSwitch(): void {
        this.switchToken++;
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
        if (!bindings || bindings.playbackStartBlocked()) {
            return Promise.resolve('superseded');
        }

        const session = this.sessionToken;
        const attempt = ++this.switchToken;

        return switchToSource(candidate, {
            controller: this.controller,
            resolve: (target, options) =>
                this.resolver.resolve(target, options),
            startPlayback: (playback, isCurrent) =>
                bindings.startPlayback(playback, isCurrent),
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
