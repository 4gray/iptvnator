import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** External-player launch feedback carried by the primary button. */
export type DetailPrimaryButtonState = 'idle' | 'launching' | 'stop';

/**
 * The light primary call to action of a details page: play icon plus a
 * two-line label ("Continue" / "S02E03 · 18m left"). The same surface as the
 * dashboard hero's primary (`light-primary-button` mixin).
 */
@Component({
    selector: 'app-detail-primary-button',
    imports: [MatIcon],
    templateUrl: './detail-primary-button.component.html',
    styleUrl: './detail-primary-button.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPrimaryButtonComponent {
    readonly label = input.required<string>();
    /** Second, smaller line: episode code, time left, duration. */
    readonly meta = input<string | null>(null);
    readonly icon = input('play_arrow');
    readonly state = input<DetailPrimaryButtonState>('idle');
    readonly disabled = input(false);
    readonly testId = input<string | null>(null);

    readonly pressed = output<void>();
}
