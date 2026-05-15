import { ScrollingModule } from '@angular/cdk/scrolling';

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    EventEmitter,
    Input,
    Output,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { FilterPipe } from '@iptvnator/pipes';
import { TranslateModule } from '@ngx-translate/core';
import {
    LiveEpgPanelState,
    persistLiveEpgPanelState,
    restoreLiveEpgPanelState,
} from '@iptvnator/portal/shared/util';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { ResizableDirective } from '@iptvnator/ui/components';
import { EpgItem, VideoPlayer, XtreamItem } from '@iptvnator/shared/interfaces';
import { EpgViewComponent } from '../epg-view/epg-view.component';
import {
    LiveEpgPanelComponent,
    LiveEpgPanelSummary,
} from '../live-epg-panel/live-epg-panel.component';

@Component({
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss'],
    imports: [
        EpgViewComponent,
        FilterPipe,
        FormsModule,
        LiveEpgPanelComponent,
        MatListModule,
        MatIconModule,
        MatInputModule,
        MatFormFieldModule,
        ResizableDirective,
        ScrollingModule,
        WebPlayerViewComponent,
        TranslateModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent {
    @Input({ required: true }) channels!: XtreamItem[];
    @Input({ required: true }) player: VideoPlayer = VideoPlayer.VideoJs;
    @Input() epgItems!: EpgItem[];
    @Input() streamUrl!: string;
    @Input() activeLiveStream!: XtreamItem;

    @Output() itemClicked = new EventEmitter<XtreamItem>();

    searchString = signal<string>('');
    readonly liveEpgPanelState = signal<LiveEpgPanelState>(
        restoreLiveEpgPanelState()
    );
    readonly isLiveEpgPanelCollapsed = computed(
        () => this.liveEpgPanelState() === 'collapsed'
    );

    trackBy(_index: number, item: XtreamItem) {
        return item.stream_id;
    }

    usesInternalPlayer(): boolean {
        return (
            this.player === VideoPlayer.VideoJs ||
            this.player === VideoPlayer.Html5Player ||
            this.player === VideoPlayer.ArtPlayer
        );
    }

    getLiveEpgPanelSummary(): LiveEpgPanelSummary | null {
        const currentProgram =
            this.epgItems?.find((item) => this.isCurrentProgram(item)) ?? null;

        if (!currentProgram) {
            return null;
        }

        return {
            title: currentProgram.title,
            start: currentProgram.start,
            stop: currentProgram.stop ?? currentProgram.end,
        };
    }

    onLiveEpgPanelCollapsedChange(collapsed: boolean): void {
        const state: LiveEpgPanelState = collapsed ? 'collapsed' : 'expanded';
        this.liveEpgPanelState.set(state);
        persistLiveEpgPanelState(state);
    }

    private isCurrentProgram(item: EpgItem): boolean {
        const end = item.stop ?? item.end;
        const now = Date.now();
        const start = new Date(item.start).getTime();
        const stop = new Date(end).getTime();
        return now >= start && now <= stop;
    }
}
