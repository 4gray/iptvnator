import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
})
export class RecentPlaylistsComponent {
    /**
     * Playlist object
     */
    @Input() playlists: any;

    /**
     * Emits on playlist click
     */
    @Output() playlistClicked: EventEmitter<any> = new EventEmitter();
}
