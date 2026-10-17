import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    untracked,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ControlsSkipSegment } from './controls-skip-segment';
import type {
    PlayerController,
    PlayerSkipSegment,
} from './player-controls.model';

/**
 * The "Skip intro" / "Skip recap" button in the player's bottom-right
 * corner, shown while the playback position is inside one of the episode's
 * segments (see `ControlsSkipSegment`). It stays visible when the controls
 * auto-hide, sitting low over the video, and rises above the dock whenever
 * the dock is shown. A press seeks to the segment's end; a segment the host
 * flags `autoSkip` is skipped on entry instead, with no button.
 */
@Component({
    selector: 'app-player-skip-segment-button',
    templateUrl: './player-skip-segment-button.component.html',
    styleUrl: './player-skip-segment-button.component.scss',
    imports: [MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'player-skip',
        '[class.player-skip--compact]': 'compact()',
        '[class.player-skip--raised]': 'raised()',
    },
})
export class PlayerSkipSegmentButtonComponent {
    readonly controller = input.required<PlayerController>();
    readonly segments = input<readonly PlayerSkipSegment[] | null>(null);
    readonly showControls = input(true);
    /** The settings panel covers the corner; the button yields while open. */
    readonly settingsOpen = input(false);
    readonly compact = input(false);
    /** The dock is shown: the button moves above it. */
    readonly raised = input(false);

    private readonly skipSegment = new ControlsSkipSegment({
        segments: this.segments,
        state: computed(() => this.controller().state()),
        capabilities: computed(() => this.controller().capabilities()),
        showControls: this.showControls,
        settingsOpen: this.settingsOpen,
        seekTo: (seconds) => this.controller().commands.seekTo(seconds),
    });
    readonly segment = this.skipSegment.buttonSegment;
    readonly labelKey = this.skipSegment.labelKey;

    constructor() {
        effect(() => {
            // Re-checked on every position update; seeks once per segment.
            void this.skipSegment.segment();
            untracked(() => this.skipSegment.autoSkip());
        });
    }

    skip(): void {
        this.skipSegment.skip();
    }
}
