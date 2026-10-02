import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** External-player launch feedback carried by the primary button. */
export type DetailActionButtonState = 'idle' | 'launching' | 'stop';

/**
 * A text action of the details row. `primary` is the light call to action:
 * play icon plus a two-line label ("Continue" / "S02E03 · 18m left"), the
 * same surface as the dashboard hero's primary (`light-primary-button`
 * mixin). `secondary` is the ghost text button beside it ("Trailer").
 */
@Component({
    selector: 'app-detail-action-button',
    imports: [MatIcon],
    templateUrl: './detail-action-button.component.html',
    styleUrl: './detail-action-button.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailActionButtonComponent {
    readonly variant = input<'primary' | 'secondary'>('primary');
    readonly label = input.required<string>();
    /** Second, smaller line: episode code, time left, duration. */
    readonly meta = input<string | null>(null);
    readonly icon = input('play_arrow');
    readonly state = input<DetailActionButtonState>('idle');
    readonly disabled = input(false);
    readonly testId = input<string | null>(null);

    readonly pressed = output<void>();
}
