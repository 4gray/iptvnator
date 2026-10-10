import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListSkeletonComponent } from '../channel-list-container/channel-list-skeleton/channel-list-skeleton.component';

/**
 * First-load placeholder for a channel list. Its headers and rows use the
 * boxes of the view it stands in for (`styles/_channel-list-layout.scss`),
 * so the list does not move when the channels arrive.
 */
@Component({
    selector: 'app-channel-list-loading-state',
    templateUrl: './channel-list-loading-state.component.html',
    styleUrl: './channel-list-loading-state.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe, ChannelListSkeletonComponent],
})
export class ChannelListLoadingStateComponent {
    readonly view = input<string>('all');
    readonly showEpg = input(true);
    /** False where the loaded view hides its header (compact lists). */
    readonly showHeader = input(true);

    readonly isGroupsView = computed(() => this.view() === 'groups');
    /** Only the "All channels" header carries the sort and hide actions. */
    readonly hasHeaderActions = computed(() => this.view() === 'all');
    readonly headerActionSlots = [0, 1] as const;
    readonly groupRows = Array.from({ length: 10 }, (_, index) => index);
    readonly groupLabelWidths = [78, 66, 84, 58, 73, 69, 81, 62, 76, 71];
}
