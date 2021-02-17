import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Playlist } from '../../playlist.interface';

@Component({
    selector: 'app-playlist-info',
    templateUrl: './playlist-info.component.html',
    styleUrls: ['./playlist-info.component.scss'],
})
export class PlaylistInfoComponent {
    /** Playlist object */
    playlist: Playlist;

    /**
     * Creates an instance of the component and injects the selected playlist from the parent component
     * @param data playlist object to show
     */
    constructor(@Inject(MAT_DIALOG_DATA) playlist: Playlist) {
        this.playlist = playlist;
    }
}
