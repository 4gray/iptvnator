import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { formatTime } from './controls-format.utils';
import type { ControlsTimeline } from './controls-timeline';
import type { ControlsTimelineHover } from './controls-timeline-hover';

/**
 * The dock's timeline row: current time, the drawn segment track with its
 * knob and hover label, the remaining time (or LIVE / `--:--`), and the
 * recording status. Presentation only — scrub state lives in
 * {@link ControlsTimeline}, and the range input's `input`/`change` events
 * go back to the controls component, which owns reveal and seeking.
 */
@Component({
    selector: 'app-player-timeline',
    templateUrl: './player-timeline.component.html',
    styleUrl: './player-timeline.component.scss',
    imports: [MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'player-controls__timeline' },
})
export class PlayerTimelineComponent {
    readonly timeline = input.required<ControlsTimeline>();
    readonly hover = input.required<ControlsTimelineHover>();
    /** The engine can seek at all; without it the track is not drawn. */
    readonly seekable = input(false);
    /** Seeking is possible right now. */
    readonly canSeek = input(false);
    readonly isLive = input(false);
    /** `−7:03`, or null without a finite duration. */
    readonly remaining = input<string | null>(null);
    readonly recordingStatus = input<string | null>(null);
    readonly recording = input(false);
    readonly scrubInput = output<Event>();
    readonly scrubCommit = output<Event>();

    readonly formatTime = formatTime;
}
