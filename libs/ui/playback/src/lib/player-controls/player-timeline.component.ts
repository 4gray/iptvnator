import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    afterRenderEffect,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { UNKNOWN_TIME_TEXT, formatTime } from './controls-format.utils';
import type { ControlsTimeline } from './controls-timeline';
import {
    type ControlsTimelineLabel,
    clampTimelineLabelLeft,
} from './controls-timeline-label';

/**
 * The dock's timeline row: current time, the drawn segment track with its
 * knob and label, the remaining time (or LIVE / `--:--`), and the
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
    private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
    readonly timeline = input.required<ControlsTimeline>();
    readonly label = input.required<ControlsTimelineLabel>();
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
    readonly unknownTime = UNKNOWN_TIME_TEXT;

    private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
    private readonly labelElement =
        viewChild<ElementRef<HTMLElement>>('labelElement');
    /**
     * Bumped when the bar or the player resizes: the label's pixel `left`
     * is stale then, even with its anchor and text unchanged (a paused
     * player, the keyboard holding the slider, a narrowed window).
     */
    private readonly resized = signal(0);

    constructor() {
        effect((onCleanup) => {
            const bar = this.bar()?.nativeElement;
            if (!bar || typeof ResizeObserver === 'undefined') {
                return;
            }
            const observer = new ResizeObserver(() =>
                this.resized.update((count) => count + 1)
            );
            observer.observe(bar);
            const player = this.host.closest('.player-controls-host');
            if (player) {
                observer.observe(player);
            }
            onCleanup(() => observer.disconnect());
        });
        // The stylesheet centres the label on its anchor; once laid out, it
        // is moved by its measured width to stay inside the player, which a
        // long programme or chapter title would otherwise overflow.
        afterRenderEffect({
            earlyRead: () => {
                const percent = this.label().percent();
                // A new title or time changes the width to clamp, and a
                // resize the room it is clamped into.
                this.label().text();
                this.resized();
                const label = this.labelElement()?.nativeElement;
                const bar = this.bar()?.nativeElement;
                if (percent === null || !label || !bar) {
                    return null;
                }
                const barRect = bar.getBoundingClientRect();
                if (!(barRect.width > 0)) {
                    return null;
                }
                const player = (
                    this.host.closest('.player-controls-host') ?? bar
                ).getBoundingClientRect();
                return {
                    label,
                    left: clampTimelineLabelLeft(
                        percent,
                        label.offsetWidth,
                        barRect,
                        player
                    ),
                };
            },
            write: (placement) => {
                const value = placement();
                if (value) {
                    value.label.style.left = `${value.left}px`;
                    value.label.style.transform = 'none';
                }
            },
        });
    }
}
