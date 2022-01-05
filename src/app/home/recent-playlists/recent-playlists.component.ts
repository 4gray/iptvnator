import { PLAYLIST_UPDATE_POSITIONS } from './../../../../shared/ipc-commands';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';
import { PlaylistMeta } from './../home.component';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DataService } from '../../services/data.service';

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
     * @param electronService electron service
     */
    constructor(
        public dialog: MatDialog,
        private electronService: DataService
    ) {}

    /**
     * Opens the details dialog with the information about the provided playlist
     * @param data selected playlist
     */
    openInfoDialog(data: PlaylistMeta): void {
        this.dialog.open(PlaylistInfoComponent, {
            data,
        });
    }

    /**
     * Drop event handler - applies the new sort order to the playlists array
     * @param event drop event
     */
    drop(event: CdkDragDrop<PlaylistMeta[]>): void {
        moveItemInArray(
            this.playlists,
            event.previousIndex,
            event.currentIndex
        );
        this.electronService.sendIpcEvent(
            PLAYLIST_UPDATE_POSITIONS,
            this.playlists
        );
    }
}
