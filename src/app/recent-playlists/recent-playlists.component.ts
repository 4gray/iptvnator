import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Playlist } from 'app/playlist-uploader/playlist.interface';

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
})
export class RecentPlaylistsComponent {
    /** All available playlists */
    @Input() playlists: Playlist[];

    /** Emits on playlist selection */
    @Output() playlistClicked: EventEmitter<string> = new EventEmitter();

    /** Emits on playlist remove click */
    @Output() removeClicked: EventEmitter<string> = new EventEmitter();

    /** Emits on playlist rename click */
    @Output() renameClicked: EventEmitter<Playlist> = new EventEmitter();
}
