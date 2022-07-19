/* eslint-disable @typescript-eslint/unbound-method */
import { DatePipe } from '@angular/common';
import { Component, Inject } from '@angular/core';
import {
    UntypedFormBuilder,
    UntypedFormControl,
    UntypedFormGroup,
    Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PLAYLIST_SAVE_DETAILS } from '../../../../../shared/ipc-commands';
import { Playlist } from '../../../../../shared/playlist.interface';
import { DataService } from '../../../services/data.service';

@Component({
    selector: 'app-playlist-info',
    templateUrl: './playlist-info.component.html',
    providers: [DatePipe],
})
export class PlaylistInfoComponent {
    /** Flag that returns true if application runs in electron-based environment */
    isElectron = this.electronService.isElectron;

    /** Playlist object */
    playlist: Playlist;

    /** Form group with playlist details */
    playlistDetails: UntypedFormGroup;

    /**
     * Creates an instance of the component and injects the selected playlist from the parent component
     * @param datePipe
     * @param formBuilder
     * @param electronService
     * @param playlist playlist object to show
     */
    constructor(
        private datePipe: DatePipe,
        private formBuilder: UntypedFormBuilder,
        private electronService: DataService,
        @Inject(MAT_DIALOG_DATA) playlist: Playlist
    ) {
        this.playlist = playlist;
    }

    /**
     * Create the form and set initial data on component init
     */
    ngOnInit(): void {
        this.playlistDetails = this.formBuilder.group({
            _id: this.playlist._id,
            title: new UntypedFormControl(this.playlist.title, Validators.required),
            userAgent: this.playlist.userAgent || '',
            filename: new UntypedFormControl({
                value: this.playlist.filename || '',
                disabled: true,
            }),
            count: new UntypedFormControl({
                value: this.playlist.count,
                disabled: true,
            }),
            importDate: new UntypedFormControl({
                value: this.datePipe.transform(this.playlist.importDate),
                disabled: true,
            }),
            url: new UntypedFormControl({ value: this.playlist.url, disabled: true }),
            filePath: new UntypedFormControl({
                value: this.playlist.filePath,
                disabled: true,
            }),
            autoRefresh: new UntypedFormControl(this.playlist.autoRefresh),
        });
    }

    /**
     * Saves updated playlist information
     * @param data updated form data
     */
    saveChanges(
        data: Pick<Playlist, '_id' | 'title' | 'userAgent' | 'autoRefresh'>
    ): void {
        this.electronService.sendIpcEvent(PLAYLIST_SAVE_DETAILS, data);
    }
}
