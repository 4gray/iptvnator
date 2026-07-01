import { NgZone, Signal, WritableSignal } from '@angular/core';
import Ferrite, { Events, type FerritePlayer } from 'ferrite.js';
import { wireFerriteEvents } from './ferrite-event-wiring';
import { type PlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';

export interface FerriteAssetUrls {
    readonly wasmBaseUrl: string;
    readonly workerUrl: string;
    readonly presentWorkerUrl: string;
    readonly audioWorkerUrl: string;
    readonly demuxWorkerUrl: string;
}

/**
 * Same-origin URLs for the engine (`ferrite.mjs`/`.wasm`, host-served via `wasmBaseUrl`) and the four
 * self-contained Worker chunks (ferrite.js 1.3.5's topology: demux, video-decode, audio-decode, present).
 * Explicit because the Angular/esbuild builder does NOT rewrite the package's internal
 * `new Worker(new URL('./worker.js', import.meta.url))` when it originates inside a node_modules
 * dependency — it leaves the literal, so the default spawn would 404. We copy
 * dist/{worker,present-worker,audio-worker,demux-worker}.js into the served assets dir (project.json) and
 * feed those URLs via the facade's {worker,presentWorker,audioWorker,demuxWorker}Url escape hatch. (Under
 * Electron file:// the context is never crossOriginIsolated, so the facade degrades before it fetches these.)
 */
export function ferriteAssetUrls(): FerriteAssetUrls {
    return {
        wasmBaseUrl: new URL('assets/', document.baseURI).href,
        workerUrl: new URL('assets/worker.js', document.baseURI).href,
        presentWorkerUrl: new URL('assets/present-worker.js', document.baseURI).href,
        audioWorkerUrl: new URL('assets/audio-worker.js', document.baseURI).href,
        demuxWorkerUrl: new URL('assets/demux-worker.js', document.baseURI).href,
    };
}

/** The component-owned signal sinks + output emitters a ferrite session writes its events into. */
export interface FerriteSessionSinks {
    readonly status: WritableSignal<string>;
    readonly tier: WritableSignal<string>;
    readonly format: WritableSignal<string>;
    readonly clock: WritableSignal<string>;
    readonly dbgVisible: Signal<boolean>;
    readonly deintFailed: WritableSignal<boolean>;
    readonly currentTime: WritableSignal<number>;
    readonly duration: WritableSignal<number>;
    readonly emitIssue: (d: PlaybackDiagnostic | null) => void;
    readonly emitTimeUpdate: (t: { currentTime: number; duration: number }) => void;
    readonly emitEnded: () => void;
}

export interface FerriteSessionOptions {
    readonly url: string;
    readonly isLive: boolean;
    readonly canvas: HTMLCanvasElement;
    readonly zone: NgZone;
    readonly urls: FerriteAssetUrls;
    readonly volume: number;
    readonly muted: boolean;
    readonly startTime: number;
    readonly sinks: FerriteSessionSinks;
}

/**
 * Create + wire + start a ferrite session and return the live player: `createPlayer` (OUTSIDE the
 * Angular zone, so the AudioContext/rAF/WebGL per-frame work never triggers change detection) → event
 * wiring → `attachCanvas` → volume/muted → VOD resume → load + play.
 */
export function startFerriteSession(opts: FerriteSessionOptions): FerritePlayer {
    const { url, isLive, sinks } = opts;
    const player = opts.zone.runOutsideAngular(() =>
        Ferrite.createPlayer(
            { type: 'mpegts', isLive, url },
            {
                wasmBaseUrl: opts.urls.wasmBaseUrl,
                workerUrl: opts.urls.workerUrl,
                presentWorkerUrl: opts.urls.presentWorkerUrl,
                audioWorkerUrl: opts.urls.audioWorkerUrl,
                demuxWorkerUrl: opts.urls.demuxWorkerUrl,
                isLive,
            }
        )
    );
    wireFerriteEvents(player, url, {
        zone: opts.zone,
        emitIssue: sinks.emitIssue,
        emitTimeUpdate: (t) => {
            sinks.currentTime.set(t.currentTime);
            sinks.duration.set(Number.isFinite(t.duration) ? t.duration : 0);
            sinks.emitTimeUpdate(t);
        },
        emitEnded: sinks.emitEnded,
        status: sinks.status,
        tier: sinks.tier,
        format: sinks.format,
        clock: sinks.clock,
        dbgVisible: sinks.dbgVisible,
        deintFailed: sinks.deintFailed,
    });
    player.attachCanvas(opts.canvas);
    player.volume = opts.volume;
    player.muted = opts.muted;

    // VOD resume: the facade has no load-time offset, so seek to the saved position once the source
    // reports a finite duration. MEDIA_INFO fires first on decoder-ready (duration still unknown) and
    // again once duration is known; clamping an out-of-range resume (≈ end of a fully-watched file)
    // inside the file avoids seeking past EOF and stalling. Live ignores it.
    const resumeAt = isLive ? 0 : Math.max(0, opts.startTime);
    if (resumeAt > 0) {
        sinks.currentTime.set(resumeAt); // reflect the resume point on the seek bar immediately
        const seekOnReady = (): void => {
            const dur = player.duration;
            if (!Number.isFinite(dur) || dur <= 0) {
                return;
            }
            player.off(Events.MEDIA_INFO, seekOnReady);
            player.seek(Math.min(resumeAt, dur - 1));
        };
        player.on(Events.MEDIA_INFO, seekOnReady);
    }

    player.load();
    void player.play();
    return player;
}

/**
 * Stop a ferrite session, OUTSIDE the Angular zone. `destroy()` is the facade's single canonical
 * teardown: it stops playback, terminates the decode + present workers (releasing the transferred
 * OffscreenCanvas + the GPU/decoder resources, and reaping the pthread pool), and clears ALL event
 * listeners — including a still-pending VOD resume `MEDIA_INFO` handler, so no stale callback can fire
 * a `seek()` against a torn-down session. Best-effort: a teardown throw is reported, not propagated,
 * so a play/stop cycle never crashes the host.
 */
export function stopFerriteSession(
    player: FerritePlayer,
    zone: NgZone,
    onError?: (message: string, err: unknown) => void
): void {
    zone.runOutsideAngular(() => {
        try {
            player.destroy();
        } catch (err) {
            onError?.('teardown error', err);
        }
    });
}
