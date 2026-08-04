import type { ChannelDrm } from '@iptvnator/shared/interfaces';
import {
    ShakaPlaybackDisposition as ShakaDisposition,
    asShakaError,
    classifyShakaPlaybackIssue,
    createPlaybackSourceMetadata,
    createShakaBrowserUnsupportedDiagnostic,
    createUnsupportedDrmDiagnostic,
    getShakaErrorEventDisposition,
    isShakaLoadInterrupted,
    type InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    type PlaybackSourceMetadata,
} from '@iptvnator/playback/util';
import { ShakaTextTrackSuppression } from './shaka-text-track-suppression';
import {
    loadShakaModule,
    type ShakaErrorLike,
    type ShakaModuleLike,
    type ShakaModuleLoader,
    type ShakaPlayerLike,
} from './shaka-module.types';

export interface ShakaVideoSessionConfig {
    player: InlinePlaybackPlayer;
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void;
    showCaptions?: () => boolean;
    loadShaka?: ShakaModuleLoader;
}

const DASH_MIME_TYPE = 'application/dash+xml';

const PLAYER_REFRESH_EVENTS = [
    'loaded',
    'trackschanged',
    'adaptation',
    'variantchanged',
    'textchanged',
    'texttrackvisibility',
] as const;

/**
 * Owns one Shaka Player engine for DASH (`.mpd`) playback, mirroring how
 * hls.js/mpegts.js engines are owned by their player components.
 *
 * - `shaka-player` is loaded lazily on the first start; the module is cached.
 * - `start()`/`stop()` are synchronous entry points; the async work is
 *   serialized on an internal chain and guarded by a generation counter, so a
 *   channel switch during an in-flight load can never resurrect a stale
 *   engine.
 * - ClearKey DRM comes from the channel's {@link ChannelDrm}; unsupported
 *   license types emit a DRM diagnostic instead of starting an engine.
 */
export class ShakaVideoSession {
    private module: ShakaModuleLike | null = null;
    private player: ShakaPlayerLike | null = null;
    private playerErrorListener: ((event: Event) => void) | null = null;
    private playerRefreshListener: (() => void) | null = null;
    private readonly refreshListeners = new Set<() => void>();
    private operationChain: Promise<void> = Promise.resolve();
    private pendingTeardown: Promise<void> = Promise.resolve();
    private readonly textSuppression = new ShakaTextTrackSuppression();
    private generation = 0;
    private destroyed = false;

    constructor(private readonly config: ShakaVideoSessionConfig) {}

    /** Starts DASH playback of `url` on `video`. Synchronous entry point. */
    start(video: HTMLVideoElement, url: string, drm?: ChannelDrm): void {
        if (this.destroyed) {
            return;
        }

        if (drm && !drm.supported) {
            this.stop();
            this.config.emitPlaybackIssue(
                createUnsupportedDrmDiagnostic(
                    drm.licenseType,
                    this.createMetadata(url)
                )
            );
            return;
        }

        const generation = ++this.generation;
        this.beginPlayerTeardown();
        this.enqueue(async () => {
            await this.pendingTeardown;
            if (this.isStale(generation)) {
                return;
            }
            await this.startPlayback(generation, video, url, drm);
        });
    }

    /** Tears down the current engine (if any) without ending the session. */
    stop(): void {
        this.generation += 1;
        this.beginPlayerTeardown();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.generation += 1;
        this.refreshListeners.clear();
        this.beginPlayerTeardown();
    }

    /** Current engine, for the shared-controls track bridge. */
    getPlayer(): ShakaPlayerLike | null {
        return this.player;
    }

    /** Registers a callback fired whenever tracks/text state may have changed. */
    subscribe(listener: () => void): () => void {
        this.refreshListeners.add(listener);
        return () => this.refreshListeners.delete(listener);
    }

    private async startPlayback(
        generation: number,
        video: HTMLVideoElement,
        url: string,
        drm: ChannelDrm | undefined
    ): Promise<void> {
        let module: ShakaModuleLike;
        try {
            module = await this.loadModule();
        } catch {
            this.emitTerminalIfCurrent(generation, null, url);
            return;
        }

        if (this.isStale(generation)) {
            return;
        }

        if (!module.Player.isBrowserSupported()) {
            this.emitIfCurrent(
                generation,
                createShakaBrowserUnsupportedDiagnostic(
                    this.createMetadata(url)
                )
            );
            return;
        }

        const player = new module.Player();
        this.player = player;
        this.bindPlayerListeners(player, generation, url);

        if (drm?.clearKeys) {
            player.configure({ drm: { clearKeys: drm.clearKeys } });
        }

        try {
            await player.attach(video);
            await player.load(url);
        } catch (error: unknown) {
            this.handleLoadFailure(generation, player, url, error);
            return;
        }

        if (this.isStale(generation)) {
            return;
        }

        // Shaka 5 shows a text track by selecting it; keep captions off when
        // the preference is disabled in case the manifest auto-selected one.
        if (!(this.config.showCaptions?.() ?? false)) {
            this.textSuppression.suppress(player);
        }
        this.notifyRefresh();
    }

    /** Hides the active text track, remembering it for a later restore. */
    suppressTextTracks(): void {
        const player = this.player;
        if (player) {
            this.textSuppression.suppress(player);
        }
    }

    /** Reselects the text track hidden by {@link suppressTextTracks}. */
    restoreSuppressedTextTrack(): void {
        const player = this.player;
        if (player) {
            this.textSuppression.restore(player);
        }
    }

    private handleLoadFailure(
        generation: number,
        player: ShakaPlayerLike,
        url: string,
        error: unknown
    ): void {
        const shakaError = asShakaError(error);
        if (
            this.isStale(generation) ||
            this.player !== player ||
            isShakaLoadInterrupted(shakaError)
        ) {
            return;
        }

        const issue = classifyShakaPlaybackIssue(
            shakaError,
            this.createMetadata(url),
            ShakaDisposition.Terminal
        );
        if (issue) {
            this.config.emitPlaybackIssue(issue);
        }
        // Never leave a non-functional engine attached to the media element
        // or exposed to the shared-controls bridge.
        this.beginPlayerTeardown();
    }

    private bindPlayerListeners(
        player: ShakaPlayerLike,
        generation: number,
        url: string
    ): void {
        const errorListener = (event: Event): void => {
            if (this.isStale(generation) || this.player !== player) {
                return;
            }

            const detail = (event as { detail?: unknown }).detail;
            const shakaError = asShakaError(detail);
            const disposition = getShakaErrorEventDisposition(shakaError);
            if (!disposition) {
                return;
            }

            const issue = classifyShakaPlaybackIssue(
                shakaError,
                this.createMetadata(url),
                disposition
            );
            if (!issue) {
                return;
            }

            this.config.emitPlaybackIssue(issue);
            // Critical errors end playback; never leave the dead engine
            // attached or exposed to the shared-controls bridge.
            this.beginPlayerTeardown();
        };
        const refreshListener = (): void => {
            if (!this.isStale(generation) && this.player === player) {
                this.notifyRefresh();
            }
        };

        this.playerErrorListener = errorListener;
        this.playerRefreshListener = refreshListener;
        player.addEventListener('error', errorListener);
        for (const event of PLAYER_REFRESH_EVENTS) {
            player.addEventListener(event, refreshListener);
        }
    }

    /**
     * Detaches and destroys the current engine immediately — never queued
     * behind pending operations. `player.destroy()` interrupts an in-flight
     * `load()` (it rejects with `LOAD_INTERRUPTED`), so a stalled manifest
     * fetch cannot wedge the operation chain. New starts await
     * {@link pendingTeardown} before attaching to the media element.
     */
    private beginPlayerTeardown(): void {
        const player = this.player;
        this.player = null;
        this.textSuppression.reset();
        if (!player) {
            this.playerErrorListener = null;
            this.playerRefreshListener = null;
            return;
        }

        if (this.playerErrorListener) {
            player.removeEventListener('error', this.playerErrorListener);
        }
        if (this.playerRefreshListener) {
            for (const event of PLAYER_REFRESH_EVENTS) {
                player.removeEventListener(event, this.playerRefreshListener);
            }
        }
        this.playerErrorListener = null;
        this.playerRefreshListener = null;
        this.notifyRefresh();

        const teardown = player.destroy().then(
            () => undefined,
            () => undefined
        );
        this.pendingTeardown = this.pendingTeardown.then(() => teardown);
    }

    private async loadModule(): Promise<ShakaModuleLike> {
        if (this.module) {
            return this.module;
        }

        const loader = this.config.loadShaka ?? loadShakaModule;
        const module = await loader();
        module.polyfill.installAll();
        this.module = module;
        return module;
    }

    private createMetadata(url: string): PlaybackSourceMetadata {
        return createPlaybackSourceMetadata({
            url,
            mimeType: DASH_MIME_TYPE,
            player: this.config.player,
        });
    }

    private enqueue(operation: () => Promise<void>): void {
        this.operationChain = this.operationChain.then(operation, operation);
    }

    private isStale(generation: number): boolean {
        return this.destroyed || generation !== this.generation;
    }

    private emitIfCurrent(generation: number, issue: PlaybackDiagnostic): void {
        if (!this.isStale(generation)) {
            this.config.emitPlaybackIssue(issue);
        }
    }

    private emitTerminalIfCurrent(
        generation: number,
        error: Partial<ShakaErrorLike> | null,
        url: string
    ): void {
        const issue = classifyShakaPlaybackIssue(
            error,
            this.createMetadata(url),
            ShakaDisposition.Terminal
        );
        if (issue) {
            this.emitIfCurrent(generation, issue);
        }
    }

    private notifyRefresh(): void {
        for (const listener of [...this.refreshListeners]) {
            listener();
        }
    }
}
