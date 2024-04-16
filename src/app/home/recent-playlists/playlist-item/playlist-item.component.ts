import { DragDropModule } from '@angular/cdk/drag-drop';
import { DatePipe, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { PlaylistMeta } from '../../../shared/playlist-meta.type';

@Component({
    standalone: true,
    selector: 'app-playlist-item',
    templateUrl: './playlist-item.component.html',
    styleUrls: ['./playlist-item.component.scss'],
    imports: [
        DatePipe,
        DragDropModule,
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatListModule,
        MatTooltipModule,
        NgIf,
        TranslateModule,
    ],
})
export class PlaylistItemComponent {
    @Input() item: PlaylistMeta;
    @Input() showActions = true;

    @Output() editPlaylistClicked = new EventEmitter<PlaylistMeta>();
    @Output() playlistClicked = new EventEmitter<string>();
    @Output() refreshClicked = new EventEmitter<PlaylistMeta>();
    @Output() removeClicked = new EventEmitter<string>();
}
