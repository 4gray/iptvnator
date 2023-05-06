import { Component, EventEmitter, Input, Output } from '@angular/core';
import { PlaylistMeta } from '../../../shared/playlist-meta.type';

@Component({
    selector: 'app-playlist-item',
    templateUrl: './playlist-item.component.html',
    styleUrls: ['./playlist-item.component.scss'],
})
export class PlaylistItemComponent {
    /** Playlist item */
    @Input() item: PlaylistMeta;

    @Input() showActions = true;

    /** Emits on playlist selection */
    @Output() playlistClicked: EventEmitter<string> = new EventEmitter();

    /** Emits on playlist refresh click */
    @Output() refreshClicked: EventEmitter<PlaylistMeta> = new EventEmitter();

    /** Emits on playlist remove click */
    @Output() removeClicked: EventEmitter<string> = new EventEmitter();

    /** Emits on playlist edit click */
    @Output() editPlaylistClicked: EventEmitter<PlaylistMeta> =
        new EventEmitter();
}
