import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * What the state says about the content that is missing:
 * - `empty`: nothing has been added or loaded yet;
 * - `no-results`: a search or filter matched nothing;
 * - `error`: loading failed;
 * - `offline`: the source or the network is unreachable.
 */
export type StateVariant = 'empty' | 'no-results' | 'error' | 'offline';

/**
 * `page` fills a route or a main content pane; `panel` fits a sidebar, a
 * list column, a drawer or a dialog body.
 */
export type StateSize = 'page' | 'panel';

/** The icon each variant shows when the caller names none. */
export const STATE_VIEW_DEFAULT_ICONS: Readonly<Record<StateVariant, string>> =
    {
        empty: 'inbox',
        'no-results': 'search_off',
        error: 'error_outline',
        offline: 'cloud_off',
    };

interface StateViewButton {
    readonly kind: 'retry' | 'action' | 'secondary';
    readonly label: string;
    readonly icon: string | null;
}

/**
 * The app's one empty, no-results, error and offline view: an icon tile, a
 * heading, a short description and at most two actions, in the dialog
 * header's vocabulary (UI-44). Callers pass translated text.
 *
 * The first button is the accent action and the second a secondary one.
 * Set `retryable` on an `error` or `offline` state whose caller can load
 * again: the state then leads with Retry and emits `retry`. Extra content,
 * such as a list of links, goes in the default slot under the actions; an
 * element with `appStateIcon` replaces the icon tile (the first-run
 * welcome's IPTVnator glyph).
 */
@Component({
    selector: 'app-state-view',
    templateUrl: './state-view.component.html',
    styleUrl: './state-view.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButton, MatIcon, TranslatePipe],
    host: {
        '[class.app-state-view--page]': "size() === 'page'",
        '[class.app-state-view--panel]': "size() === 'panel'",
        '[class.app-state-view--warn]': "variant() === 'error'",
        '[class.app-state-view--quiet]': "variant() === 'offline'",
        '[attr.data-state-variant]': 'variant()',
    },
})
export class StateViewComponent {
    readonly variant = input<StateVariant>('empty');
    readonly size = input<StateSize>('page');
    /** A Material icon name; defaults to the variant's icon. */
    readonly icon = input<string | null | undefined>(undefined);
    readonly heading = input.required<string>();
    readonly description = input<string | null | undefined>(undefined);
    /** The heading level; defaults to 2 on a page and 3 in a panel. */
    readonly headingLevel = input<2 | 3 | 4 | null>(null);

    /** Leads with a Retry button on an `error` or `offline` state. */
    readonly retryable = input(false);
    readonly actionLabel = input<string | null | undefined>(undefined);
    readonly actionIcon = input<string | null | undefined>(undefined);
    /** Disables the caller's action while it cannot run. */
    readonly actionDisabled = input(false);
    readonly secondaryLabel = input<string | null | undefined>(undefined);
    readonly secondaryIcon = input<string | null | undefined>(undefined);

    readonly retry = output<void>();
    readonly action = output<void>();
    readonly secondaryAction = output<void>();

    readonly resolvedIcon = computed(
        () => this.icon() || STATE_VIEW_DEFAULT_ICONS[this.variant()]
    );
    readonly resolvedHeadingLevel = computed(
        () => this.headingLevel() ?? (this.size() === 'page' ? 2 : 3)
    );
    /** Errors interrupt; the other states describe what is on screen. */
    readonly role = computed(() =>
        this.variant() === 'error' ? 'alert' : 'status'
    );
    readonly showsRetry = computed(
        () =>
            this.retryable() &&
            (this.variant() === 'error' || this.variant() === 'offline')
    );

    /** Retry, the caller's action and its secondary action, at most two. */
    readonly buttons = computed<readonly StateViewButton[]>(() => {
        const buttons: StateViewButton[] = [];
        if (this.showsRetry()) {
            buttons.push({ kind: 'retry', label: '', icon: 'refresh' });
        }
        const actionLabel = this.actionLabel();
        if (actionLabel) {
            buttons.push({
                kind: 'action',
                label: actionLabel,
                icon: this.actionIcon() ?? null,
            });
        }
        const secondaryLabel = this.secondaryLabel();
        if (secondaryLabel) {
            buttons.push({
                kind: 'secondary',
                label: secondaryLabel,
                icon: this.secondaryIcon() ?? null,
            });
        }
        return buttons.slice(0, 2);
    });

    onButton(kind: StateViewButton['kind']): void {
        if (kind === 'retry') this.retry.emit();
        else if (kind === 'action') this.action.emit();
        else this.secondaryAction.emit();
    }
}
