import { computed, effect, untracked } from '@angular/core';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { WebPlayerTileMedia } from './web-player-tile-media';

/**
 * How much player chrome a multiview tile shows. `full` is the normal
 * single player; `minimal` and `none` hide the engine's own dock and
 * shortcuts so the multiview stage can draw tile chrome instead.
 */
export type WebPlayerControlsMode = 'full' | 'minimal' | 'none';

/** What the tile mode reads from and reports to its view. */
export interface WebPlayerTileHost {
    readonly controlsMode: () => WebPlayerControlsMode;
    readonly muted: () => boolean | null;
    readonly paused: () => boolean | null;
    readonly playbackInteractionEnabled: () => boolean;
    readonly visiblePlaybackDiagnostic: () => PlaybackDiagnostic | null;
    readonly audioRequested: { emit(value: void): void };
    readonly diagnosticChanged: {
        emit(value: PlaybackDiagnostic | null): void;
    };
    /** Element that contains every engine the view renders. */
    readonly fullscreenSurface: HTMLElement;
}

/**
 * Multiview tile behaviour of `WebPlayerViewComponent`. With its defaults
 * (`full`, unmanaged mute and pause) it changes nothing: engines keep their
 * interaction, panels render as before and no media element is touched.
 * Must be created in an injection context.
 */
export class WebPlayerTileMode {
    /** Engine dock, shortcuts, diagnostic and fullscreen panels. */
    readonly chromeVisible = computed(
        () => this.host.controlsMode() === 'full'
    );
    readonly engineInteractionEnabled = computed(
        () => this.host.playbackInteractionEnabled() && this.chromeVisible()
    );
    private media: WebPlayerTileMedia | null = null;

    constructor(private readonly host: WebPlayerTileHost) {
        effect(() => {
            const muted = host.muted();
            const paused = host.paused();
            if (muted === null && paused === null && !this.media) return;
            untracked(() => {
                this.media ??= new WebPlayerTileMedia({
                    root: host.fullscreenSurface,
                    onAudioRequested: () => host.audioRequested.emit(),
                });
                this.media.sync(muted, paused);
            });
        });

        // The tile draws its own error overlay from this (spec 9.6).
        let reported: PlaybackDiagnostic | null = null;
        effect(() => {
            const diagnostic = host.visiblePlaybackDiagnostic();
            if (diagnostic === reported) return;
            reported = diagnostic;
            untracked(() => host.diagnosticChanged.emit(diagnostic));
        });
    }

    destroy(): void {
        this.media?.destroy();
        this.media = null;
    }
}
