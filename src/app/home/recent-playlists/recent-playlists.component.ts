import { Component, Input, Output, EventEmitter } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';
import { PlaylistMeta } from './../home.component';

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
})
export class RecentPlaylistsComponent {
    /** All available playlists */
    @Input() playlists: PlaylistMeta[];

    /** Emits on playlist selection */
    @Output() playlistClicked: EventEmitter<string> = new EventEmitter();

    /** Emits on playlist refresh click */
    @Output() refreshClicked: EventEmitter<PlaylistMeta> = new EventEmitter();

    /** Emits on playlist remove click */
    @Output() removeClicked: EventEmitter<string> = new EventEmitter();

    /**
     * Creates an instance of the component
     * @param dialog angular material dialog reference
     */
    constructor(public dialog: MatDialog) {}

    /**
     * Opens the details dialog with the information about the provided playlist
     * @param data selected playlist
     */
    openInfoDialog(data: PlaylistMeta): void {
        this.dialog.open(PlaylistInfoComponent, {
            data,
        });
    }
}
