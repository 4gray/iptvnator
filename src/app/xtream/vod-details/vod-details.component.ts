import { JsonPipe, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { XtreamVodDetails } from '../../../../shared/xtream-vod-details.interface';

@Component({
    selector: 'app-vod-details',
    templateUrl: './vod-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [JsonPipe, MatButtonModule, NgIf],
})
export class VodDetailsComponent {
    @Input({ required: true }) item: XtreamVodDetails;

    @Output() playClicked = new EventEmitter<void>();
}
