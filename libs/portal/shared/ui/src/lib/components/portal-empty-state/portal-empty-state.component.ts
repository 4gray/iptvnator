import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-portal-empty-state',
    templateUrl: './portal-empty-state.component.html',
    styleUrl: './portal-empty-state.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButton, MatIcon],
})
export class PortalEmptyStateComponent {
    readonly icon = input<string>('live_tv');
    readonly message = input.required<string>();
    /** One short secondary sentence under the title. */
    readonly hint = input<string | null>(null);
    /** Renders the primary action button; the host reacts to `action`. */
    readonly actionLabel = input<string | null>(null);
    readonly actionIcon = input<string | null>(null);
    readonly action = output<void>();
}
