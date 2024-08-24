import { ScrollingModule } from '@angular/cdk/scrolling';
import { NgIf } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    Input,
    Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { VideoPlayer } from '../../settings/settings.interface';
import { EpgItem } from '../../xtream/epg-item.interface';
import { EpgViewComponent } from '../epg-view/epg-view.component';
import { WebPlayerViewComponent } from '../web-player-view/web-player-view.component';

@Component({
    standalone: true,
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss'],
    imports: [
        EpgViewComponent,
        MatListModule,
        NgIf,
        ScrollingModule,
        WebPlayerViewComponent,
        FormsModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent {
    @Input({ required: true }) channels: XtreamItem[];
    @Input({ required: true }) player: VideoPlayer = VideoPlayer.VideoJs;
    @Input() epgItems: EpgItem[];
    @Input() streamUrl: string;

    @Output() itemClicked = new EventEmitter<XtreamItem>();

    trackBy(_index: number, item: XtreamItem) {
        return item.stream_id;
    }
}
