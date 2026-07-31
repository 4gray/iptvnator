import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListSkeletonComponent } from '../channel-list-container/channel-list-skeleton/channel-list-skeleton.component';

@Component({
    selector: 'app-channel-list-loading-state',
    templateUrl: './channel-list-loading-state.component.html',
    styleUrl: './channel-list-loading-state.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListSkeletonComponent,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        TranslatePipe,
    ],
})
export class ChannelListLoadingStateComponent {
    readonly view = input<string>('all');
    readonly showEpg = input(true);
    readonly groupsPanelExpanded = input(true);
    readonly groupsPanelRestoreAvailable = input(true);
    readonly channelsPanelExpanded = input(true);
    readonly groupsPanelExpandedChange = output<boolean>();
    readonly channelsPanelExpandedChange = output<boolean>();

    readonly isGroupsView = computed(() => this.view() === 'groups');
    readonly groupRows = Array.from({ length: 10 }, (_, index) => index);
    readonly groupLabelWidths = [78, 66, 84, 58, 73, 69, 81, 62, 76, 71];
}
