import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PortalEmptyStateComponent } from '../portal-empty-state/portal-empty-state.component';

/**
 * Content-area placeholder for a live layout whose channel rail is collapsed
 * and nothing is playing. It replaces the "select a channel" empty state,
 * which would otherwise ask the user to pick from a list they cannot see,
 * and gives the collapsed state a full-size way back next to the 32px
 * restore chevron. Every live host (M3U player, Xtream/Stalker live layouts,
 * unified live tab) renders this same component so the copy stays identical.
 */
@Component({
    selector: 'app-channel-list-hidden-state',
    imports: [PortalEmptyStateComponent, TranslatePipe],
    template: `
        <app-portal-empty-state
            icon="view_sidebar"
            [message]="'LAYOUT.CHANNELS_LIST_HIDDEN' | translate"
            [hint]="'LAYOUT.CHANNELS_LIST_HIDDEN_HINT' | translate"
            [actionLabel]="'LAYOUT.SHOW_CHANNELS_LIST' | translate"
            actionIcon="chevron_right"
            (action)="restore.emit()"
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
})
export class ChannelListHiddenStateComponent {
    readonly restore = output<void>();
}
