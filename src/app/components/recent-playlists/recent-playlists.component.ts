import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Playlist } from '../playlist-uploader/playlist-uploader.component';

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
})
export class RecentPlaylistsComponent {
    /** All available playlists */
    @Input() playlists: Playlist[];

    /** Emits on playlist selection */
    @Output() playlistClicked: EventEmitter<Playlist> = new EventEmitter();

    /** Emits on playlist remove click */
    @Output() removeClicked: EventEmitter<Playlist> = new EventEmitter();

    /** Emits on playlist rename click */
    @Output() renameClicked: EventEmitter<Playlist> = new EventEmitter();
}
