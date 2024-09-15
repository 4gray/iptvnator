import { ScrollingModule } from '@angular/cdk/scrolling';
import { NgIf } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
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
import { TranslateModule } from '@ngx-translate/core';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { VideoPlayer } from '../../settings/settings.interface';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
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
        FilterPipe,
        FormsModule,
        MatListModule,
        MatIconModule,
        MatInputModule,
        MatFormFieldModule,
        NgIf,
        ScrollingModule,
        WebPlayerViewComponent,
        TranslateModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent {
    @Input({ required: true }) channels: XtreamItem[];
    @Input({ required: true }) player: VideoPlayer = VideoPlayer.VideoJs;
    @Input() epgItems: EpgItem[];
    @Input() streamUrl: string;

    @Output() itemClicked = new EventEmitter<XtreamItem>();

    searchString = signal<string>('');

    trackBy(_index: number, item: XtreamItem) {
        return item.stream_id;
    }
}
