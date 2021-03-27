/* eslint-disable @typescript-eslint/unbound-method */
import { DatePipe } from '@angular/common';
import { Component, Inject } from '@angular/core';
import {
    FormBuilder,
    FormControl,
    FormGroup,
    Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PLAYLIST_SAVE_DETAILS } from '../../../../../ipc-commands';
import { ElectronService } from '../../../services/electron.service';
import { Playlist } from '../../playlist.interface';

@Component({
    selector: 'app-playlist-info',
    templateUrl: './playlist-info.component.html',
    styleUrls: ['./playlist-info.component.scss'],
    providers: [DatePipe],
})
export class PlaylistInfoComponent {
    /** Playlist object */
    playlist: Playlist;

    playlistDetails: FormGroup;

    /**
     * Creates an instance of the component and injects the selected playlist from the parent component
     * @param playlist playlist object to show
     */
    constructor(
        @Inject(MAT_DIALOG_DATA) playlist: Playlist,
        datePipe: DatePipe,
        formBuilder: FormBuilder,
        private electronService: ElectronService
    ) {
        this.playlist = playlist;
        this.playlistDetails = formBuilder.group({
            _id: playlist._id,
            title: new FormControl(playlist.title, Validators.required),
            userAgent: playlist.userAgent || '',
            filename: new FormControl({
                value: playlist.filename || '',
                disabled: true,
            }),
            count: new FormControl({ value: playlist.count, disabled: true }),
            importDate: new FormControl({
                value: datePipe.transform(playlist.importDate),
                disabled: true,
            }),
            url: new FormControl({ value: playlist.url, disabled: true }),
        });
    }

    /**
     * Saves updated playlist information
     * @param data updated form data
     */
    saveChanges(data: Pick<Playlist, '_id' | 'title' | 'userAgent'>): void {
        this.electronService.ipcRenderer.send(PLAYLIST_SAVE_DETAILS, data);
    }
}
