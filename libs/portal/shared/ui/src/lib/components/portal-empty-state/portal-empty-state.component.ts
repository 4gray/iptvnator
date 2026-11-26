import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import {
    StateSize,
    StateVariant,
    StateViewComponent,
} from '@iptvnator/ui/state';

/**
 * The live layouts' content-area prompt ("select a channel", "channel list
 * hidden") and the live lists' empty and no-results states, drawn by the
 * shared `app-state-view`.
 */
@Component({
    selector: 'app-portal-empty-state',
    template: `
        <app-state-view
            [variant]="variant()"
            [size]="size()"
            [icon]="icon()"
            [heading]="message()"
            [description]="hint()"
            [actionLabel]="actionLabel()"
            [actionIcon]="actionIcon()"
            (action)="action.emit()"
        />
    `,
    styles: `
        :host {
            display: flex;
            flex: 1;
            min-height: 0;
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [StateViewComponent],
})
export class PortalEmptyStateComponent {
    readonly variant = input<StateVariant>('empty');
    readonly size = input<StateSize>('page');
    readonly icon = input<string>('live_tv');
    readonly message = input.required<string>();
    /** One short secondary sentence under the title. */
    readonly hint = input<string | null>(null);
    /** Renders the primary action button; the host reacts to `action`. */
    readonly actionLabel = input<string | null>(null);
    readonly actionIcon = input<string | null>(null);
    readonly action = output<void>();
}
