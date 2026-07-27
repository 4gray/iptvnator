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
    audioDiffersFactually,
} from '@iptvnator/portal/shared/data-access';
import {
    SettingsStore,
    StreamProbeService,
    VodSourcePinService,
} from '@iptvnator/services';
import {
    vodMultiSourceMovieKey,
    type VodMultiSourceMovie,
} from './vod-multi-source-identity';
import {
    buildVodSourceMatchKey,
    buildVodSourceMatchKeyCandidates,
    type ResolvedPortalPlayback,
    type VodSourceCandidate,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';

/**
 * Wires VOD multi-source into one open movie on the Xtream detail page.
 *
 * Component-provided, not root-provided: the controller's "each source is
 * tried at most once" set must die with the movie, or a later film would
 * inherit a poisoned failover history.
 *
 * The host component supplies the movie identity and the two playback seams
 * (start a playback, read the live position) through `bind()`, so this service
 * never reaches into the route component.
 */

export interface VodMultiSourceBindings {
    /** Applies a playback — inline swap or external launch, host's choice. */
    startPlayback: (playback: ResolvedPortalPlayback) => void;
    /** The movie on screen, or null while its identity is not yet knowable. */
    movie: Signal<VodMultiSourceMovie | null>;
}

export interface VodMultiSourceSwitchNotice {
    playlistName: string;
    resumeSeconds: number;
    /** Both sides state an audio track AS FACT and those facts differ. */
    audioMayDiffer: boolean;
    quality?: string;
    container?: string;
}

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
    /** Guards against a stale discovery resolving after the user moved on. */
    private discoveryToken = 0;
    private lastMovieKey: string | null = null;
    /**
     * Bumped by every switch. Two things can go wrong across the `await` in
     * `switchTo`: a newer switch may already have committed (the slower
     * resolution would then overwrite the user's latest choice and the Undo
     * target), or the user may have navigated to another movie entirely (the
     * continuation would activate the old film's source in the new session and
     * restart it from that session's zero resume position).
     */
    private switchToken = 0;

    /** True while `session`/`switch` still describe the operation in flight. */
    private isCurrentSwitch(session: number, attempt: number): boolean {
        return session === this.discoveryToken && attempt === this.switchToken;
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
    readonly alternativeCount = computed(() => this.alternatives().length);
    readonly matchKind = computed(() => this.controller.matchKind());

    /** Opt-in and off by default — a silent switch is never acceptable. */
    readonly autoFailoverEnabled = computed(
        () => this.settingsStore.vodAutoFailover?.() === true
    );

    /** Live getter, not a snapshot: `isAvailable` is itself a getter over
     * the Electron bridge, so copying it once could disagree with it. */
    get isAvailable(): boolean {
        return this.discovery.isAvailable;
    }

    /**
     * Wire the host's playback seam and start watching the movie on screen.
     *
     * The effect lives here rather than in the route component because it is
     * this service's own lifecycle: the router REUSES the detail component for
     * detail-to-detail navigation, so a new movie must fully reset the session
     * — above all the tried-source set that makes failover terminate.
     */
    bind(bindings: VodMultiSourceBindings): void {
        this.bindings = bindings;

        effect(() => {
            const movie = bindings.movie();
            if (!movie) {
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
     * Start a fresh session for a movie. The router REUSES this component for
     * detail→detail navigation, so this must fully reset — including the
     * tried-source set.
     */
    async load(movie: VodMultiSourceMovie): Promise<void> {
        const token = ++this.discoveryToken;

        this.controller = new VodMultiSourceController();
        this._sources.set([]);
        this._lastSwitch.set(null);
        this._busySourceId.set(null);
        this._previousSourceId.set(null);
        this.matchKeys = buildVodSourceMatchKeyCandidates(movie);

        if (!this.discovery.isAvailable) {
            return;
        }

        const result = await this.discovery.discover({
            title: movie.title,
            year: movie.year,
            currentPlaylistId: movie.playlistId,
        });
        if (token !== this.discoveryToken) {
            return;
        }

        // The playing source is part of the list, so the popover can show it
        // as current rather than pretending the movie came from nowhere.
        const current: VodSourceCandidate = {
            id: `${movie.playlistId}:xtream:${movie.contentId}`,
            playlistId: movie.playlistId,
            playlistName: movie.playlistName,
            portalType: 'xtream',
            contentId: movie.contentId,
            rawTitle: movie.title,
            matchConfidence: 'exact',
            year: movie.year ?? null,
        };

        this.controller.setSources(
            [current, ...result.sources],
            result.matchKind
        );
        this.controller.setActiveSource(current.id);

        const pin = await this.pins.get(this.matchKeys);
        if (token !== this.discoveryToken) {
            return;
        }
        if (pin) {
            this.controller.setPinnedSource(
                `${pin.playlistId}:${pin.portalType}:${pin.contentId}`
            );
        }

        this.publish();
    }

    /** Play from a specific source once; does not change the pin. */
    async play(sourceId: string): Promise<boolean> {
        const candidate = this.controller.findSource(sourceId);
        if (!candidate || !this.bindings) {
            return false;
        }

        this._busySourceId.set(sourceId);
        try {
            return await this.switchTo(candidate);
        } finally {
            this._busySourceId.set(null);
        }
    }

    /** Pin or unpin this source as the movie's preferred one. */
    async togglePin(sourceId: string): Promise<void> {
        if (this.matchKeys.length === 0) {
            return;
        }

        const alreadyPinned = this._sources().some(
            (source) => source.id === sourceId && source.isPinned
        );

        if (alreadyPinned) {
            await this.pins.clear(this.matchKeys);
            this.controller.setPinnedSource(null);
            this.publish();
            return;
        }

        const candidate = this.controller.findSource(sourceId);
        if (!candidate) {
            return;
        }

        // Written under the most-trusted key; lookups pass every alias, so a
        // TMDB id arriving later does not orphan this row.
        const matchKey = this.matchKeys[0] ?? buildVodSourceMatchKey(candidate);
        if (!matchKey) {
            return;
        }

        await this.pins.set({
            matchKey,
            playlistId: candidate.playlistId,
            contentId: candidate.contentId,
            portalType: candidate.portalType,
        });
        this.controller.setPinnedSource(sourceId);
        this.publish();
    }

    /** User-triggered availability check for one row. */
    async check(sourceId: string): Promise<void> {
        const candidate = this.controller.findSource(sourceId);
        if (!candidate) {
            return;
        }

        // Same hazard as a switch: two awaits follow, and the user may open a
        // different movie meanwhile. Writing a probe result into the new
        // movie's controller would attach it to an unrelated source.
        const session = this.discoveryToken;
        const controller = this.controller;

        controller.setProbe(sourceId, { status: 'probing' });
        this.publish();

        const resolved = await this.resolver.resolve(candidate);
        if (session !== this.discoveryToken) {
            return;
        }

        if (!resolved) {
            // We could not even build a URL — that is "cannot check", not
            // "this source is dead".
            controller.setProbe(sourceId, { status: 'unknown' });
            this.publish();
            return;
        }

        controller.updateSource(resolved.candidate);
        const result = await this.probes.probe(resolved.playback.streamUrl);
        if (session !== this.discoveryToken) {
            return;
        }

        controller.setProbe(sourceId, result);
        this.publish();
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

        const target = this.controller.pickFailoverTarget();
        if (!target) {
            return null;
        }

        const switched = await this.switchTo(target);
        return switched ? this._lastSwitch() : null;
    }

    /** True once every alternative has been attempted this session. */
    isExhausted(): boolean {
        return this.controller.isExhausted();
    }

    /** Feeds the live player position; called ahead of the persist throttle. */
    reportPosition(seconds: number): void {
        this.controller.setResumeSeconds(seconds);
    }

    private async switchTo(candidate: VodSourceCandidate): Promise<boolean> {
        if (!this.bindings) {
            return false;
        }

        const session = this.discoveryToken;
        const attempt = ++this.switchToken;
        // Snapshot the controller: `load()` swaps in a fresh one for a new
        // movie, and the continuation below must never touch that one.
        const controller = this.controller;

        // Read the LIVE position, not the persisted one: the DB value lags by
        // up to 15 seconds and switching would visibly rewind.
        const resumeSeconds = Math.floor(controller.getResumeSeconds());

        const previous = controller.findSource(
            controller.activeSourceId() ?? ''
        );

        const resolved = await this.resolver.resolve(candidate, {
            startTime: resumeSeconds,
        });
        if (!this.isCurrentSwitch(session, attempt)) {
            // Superseded mid-flight — dropping the result is the whole point.
            return false;
        }

        if (!resolved) {
            // Mark it tried without making it active: a source we cannot even
            // build a URL for must not be offered again by failover, but it
            // never started playing either.
            controller.markTried(candidate.id);
            this.publish();
            return false;
        }

        controller.updateSource(resolved.candidate);
        this._previousSourceId.set(previous?.id ?? null);
        controller.setActiveSource(candidate.id);
        controller.setResumeSeconds(resumeSeconds);
        this.bindings.startPlayback(resolved.playback);

        this._lastSwitch.set({
            playlistName: candidate.playlistName,
            resumeSeconds,
            audioMayDiffer: audioDiffersFactually(previous, resolved.candidate),
            quality: resolved.candidate.quality?.value,
            container: resolved.candidate.container?.value,
        });
        this.publish();
        return true;
    }

    private publish(): void {
        this._sources.set(this.controller.sources());
    }
}
