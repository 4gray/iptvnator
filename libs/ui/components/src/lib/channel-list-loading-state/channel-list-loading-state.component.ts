import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListSkeletonComponent } from '../channel-list-container/channel-list-skeleton/channel-list-skeleton.component';

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

    readonly isGroupsView = computed(() => this.view() === 'groups');
    readonly groupRows = Array.from({ length: 10 }, (_, index) => index);
    readonly groupLabelWidths = [78, 66, 84, 58, 73, 69, 81, 62, 76, 71];
}
