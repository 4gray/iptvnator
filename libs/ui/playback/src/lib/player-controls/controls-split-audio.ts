import { computed, inject, type Signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { SplitAudioService } from '@iptvnator/services';
import { SplitAudioDialogComponent } from '@iptvnator/ui/components';
import type { PlayerControlsState } from './player-controls.model';

/**
 * "Audio from another channel" button of the control bar. Offered for live
 * playback once a channel list has published the channels to choose from.
 * Create it in an injection context (a component field).
 */
export class ControlsSplitAudio {
    private readonly dialog = inject(MatDialog);
    private readonly splitAudio = inject(SplitAudioService);

    constructor(private readonly state: Signal<PlayerControlsState>) {}

    readonly available = computed(
        () => this.splitAudio.context() !== null && this.state().isLive
    );

    open(): void {
        const context = this.splitAudio.context();
        if (!context) {
            return;
        }
        // The dialog lives in the page overlay, which is hidden behind a
        // fullscreen element.
        if (document.fullscreenElement) {
            void document.exitFullscreen?.().catch(() => undefined);
        }
        SplitAudioDialogComponent.open(this.dialog, context);
    }
}
