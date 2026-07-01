import { NgZone, Signal, WritableSignal } from '@angular/core';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    classifyMpegTsPlaybackIssue,
    createPlaybackSourceMetadata,
} from '../playback-diagnostics/playback-diagnostics.util';
import { formatTime } from '../embedded-mpv-player/embedded-mpv-format.utils';
import { Events, type FerritePlayer } from 'ferrite.js';

/**
 * The signal sinks + host-output emitters the facade events feed. Kept as a bag so the wiring lives
 * outside the component (file-size budget) while still driving the component's OnPush signals.
 */
export interface FerriteEventSinks {
    zone: NgZone;
    emitIssue: (d: PlaybackDiagnostic | null) => void;
    emitTimeUpdate: (t: { currentTime: number; duration: number }) => void;
    emitEnded: () => void;
    status: WritableSignal<string>;
    tier: WritableSignal<string>;
    format: WritableSignal<string>;
    clock: WritableSignal<string>;
    dbgVisible: Signal<boolean>;
    deintFailed: WritableSignal<boolean>;
}

/**
 * Wire the ferrite facade events to the host outputs + debug signals. Mirrors the host contract:
 * ERROR is fatal-gated (non-fatal EarlyEof during B3 reconnect retries is swallowed, only marking
 * the debug status), TIME_UPDATE is throttled to ~4 Hz before the zone re-entry (per-frame otherwise
 * → CD storm), MEDIA_INFO feeds the debug tier/format, LOADING_COMPLETE ends playback.
 */
export function wireFerriteEvents(
    player: FerritePlayer,
    url: string,
    sinks: FerriteEventSinks
): void {
    const metadata = createPlaybackSourceMetadata({
        url,
        mimeType: 'video/mp2t',
        player: InlinePlaybackPlayer.Ferrite,
    });
    let lastTimeUpdateMs = 0;

    player.on(Events.ERROR, (type: string, details: string, info: unknown) => {
        const fatal = !(
            info &&
            typeof info === 'object' &&
            (info as { fatal?: boolean }).fatal === false
        );
        if (!fatal) {
            sinks.status.set('reconnecting'); // recoverable — keep playing
            return;
        }
        sinks.status.set(`error: ${details}`);
        sinks.zone.run(() =>
            sinks.emitIssue(
                classifyMpegTsPlaybackIssue({ type, details, info }, metadata)
            )
        );
    });

    player.on(Events.RECOVERED_EARLY_EOF, () => {
        sinks.status.set('playing');
        sinks.zone.run(() => sinks.emitIssue(null));
    });

    // Decoder up + format known (tier/codecs) → feed the debug panel; a rare event (once + on
    // resolution change), so the signal writes are cheap, not a per-frame source.
    player.on(Events.MEDIA_INFO, () => {
        const i = player.mediaInfo;
        sinks.tier.set(player.tier);
        sinks.status.set('playing');
        if (i) {
            const dims = i.width && i.height ? `${i.width}×${i.height}` : '';
            sinks.format.set(
                `${i.videoCodec ?? '?'} ${dims} / ${i.audioCodec ?? '?'}`.trim()
            );
        }
    });

    player.on(Events.TIME_UPDATE, (currentTime: number) => {
        const now = performance.now();
        if (now - lastTimeUpdateMs < 250) {
            return;
        }
        lastTimeUpdateMs = now;
        if (sinks.dbgVisible()) {
            sinks.clock.set(formatTime(currentTime)); // cheap; panel-gated
        }
        sinks.zone.run(() =>
            sinks.emitTimeUpdate({ currentTime, duration: player.duration })
        );
    });

    player.on(Events.LOADING_COMPLETE, () =>
        sinks.zone.run(() => sinks.emitEnded())
    );

    // DEINT_FAILED carries the current state (true = avfilter graph won't build for this geometry,
    // false = it rebuilt), so it both lights AND clears the "deint n/a" warning. Rare (per geometry).
    player.on(Events.DEINT_FAILED, (failed: boolean) =>
        sinks.deintFailed.set(!!failed)
    );
}
