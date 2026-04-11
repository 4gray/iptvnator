import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-channel-list-loading-state',
    templateUrl: './channel-list-loading-state.component.html',
    styleUrl: './channel-list-loading-state.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [TranslatePipe],
})
export class ChannelListLoadingStateComponent {
    readonly view = input<string>('all');

    readonly isGroupsView = computed(() => this.view() === 'groups');
    readonly channelRows = Array.from({ length: 9 }, (_, index) => index);
    readonly groupRows = Array.from({ length: 10 }, (_, index) => index);
    readonly channelMetaWidths = [38, 34, 42, 36, 44, 35, 40, 32, 39];
    readonly channelTitleWidths = [72, 61, 68, 54, 78, 64, 70, 57, 75];
    readonly groupLabelWidths = [78, 66, 84, 58, 73, 69, 81, 62, 76, 71];
}
