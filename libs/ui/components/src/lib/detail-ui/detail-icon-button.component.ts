import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

/** Which accent an active icon button takes. */
export type DetailIconButtonTone = 'favorite' | 'watched' | 'done' | 'none';

/**
 * 44px ghost icon button of the details action row (Favorites, Mark as
 * watched, Download, More). The label is both the tooltip and the accessible
 * name. A projected `[glyph]` (the download progress ring) replaces the icon.
 */
@Component({
    selector: 'app-detail-icon-button',
    imports: [MatIcon, MatTooltip],
    templateUrl: './detail-icon-button.component.html',
    styleUrl: './detail-icon-button.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailIconButtonComponent {
    readonly label = input.required<string>();
    readonly icon = input<string | null>(null);
    readonly active = input(false);
    readonly tone = input<DetailIconButtonTone>('none');
    /** Set for toggles; `null` leaves `aria-pressed` off a plain action. */
    readonly pressedState = input<boolean | null>(null);
    readonly disabled = input(false);
    readonly pulsing = input(false);
    readonly testId = input<string | null>(null);

    readonly pressed = output<void>();
}
