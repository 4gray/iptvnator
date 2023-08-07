/* eslint-disable @typescript-eslint/unbound-method */
import { CommonModule, DatePipe } from '@angular/common';
import { Component, Inject } from '@angular/core';
import {
    FormControl,
    ReactiveFormsModule,
    UntypedFormBuilder,
    UntypedFormGroup,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { Playlist } from '../../../../../shared/playlist.interface';
import { DataService } from '../../../services/data.service';
import { PlaylistsService } from '../../../services/playlists.service';
import { PlaylistMeta } from '../../../shared/playlist-meta.type';
import * as PlaylistActions from '../../../state/actions';

@Component({
    selector: 'app-playlist-info',
    templateUrl: './playlist-info.component.html',
    styles: [
        `
            .spacer {
                flex: 1 1 auto;
            }
        `,
    ],
    providers: [DatePipe],
    imports: [
        TranslateModule,
        MatButtonModule,
        MatIconModule,
        MatInputModule,
        MatCheckboxModule,
        CommonModule,
        ReactiveFormsModule,
        MatDialogModule,
    ],
    standalone: true,
})
export class PlaylistInfoComponent {
    /** Flag that returns true if application runs in electron-based environment */
    isElectron = this.dataService.isElectron;

    /** Playlist object */
    playlist: Playlist;

    /** Form group with playlist details */
    playlistDetails: UntypedFormGroup;

    constructor(
        private datePipe: DatePipe,
        private formBuilder: UntypedFormBuilder,
        private dataService: DataService,
        @Inject(MAT_DIALOG_DATA) playlist: Playlist,
        private playlistService: PlaylistsService,
        private store: Store
    ) {
        this.playlist = playlist;
    }

    /**
     * Create the form and set initial data on component init
     */
    ngOnInit(): void {
        this.playlistDetails = this.formBuilder.group({
            _id: this.playlist._id,
            title: new FormControl(this.playlist.title, Validators.required),
            userAgent: this.playlist.userAgent || '',
            filename: new FormControl({
                value: this.playlist.filename || '',
                disabled: true,
            }),
            count: new FormControl({
                value: this.playlist.count,
                disabled: true,
            }),
            importDate: new FormControl({
                value: this.datePipe.transform(this.playlist.importDate),
                disabled: true,
            }),
            url: new FormControl({
                value: this.playlist.url,
                disabled: true,
            }),
            filePath: new FormControl({
                value: this.playlist.filePath,
                disabled: true,
            }),
            autoRefresh: new FormControl(this.playlist.autoRefresh),
            serverUrl: new FormControl(this.playlist.serverUrl),
            username: new FormControl(this.playlist.username),
            password: new FormControl(this.playlist.password),
            macAddress: new FormControl(this.playlist.macAddress),
            portalUrl: new FormControl(this.playlist.portalUrl),
        });
    }

    saveChanges(playlist: PlaylistMeta): void {
        this.store.dispatch(PlaylistActions.updatePlaylistMeta({ playlist }));
    }

    async exportPlaylist() {
        const playlistAsString = await firstValueFrom(
            this.playlistService.getRawPlaylistById(this.playlist._id)
        );
        const element = document.createElement('a');
        element.setAttribute(
            'href',
            'data:text/plain;charset=utf-8,' +
                encodeURIComponent(playlistAsString)
        );
        element.setAttribute('download', this.playlist.title || 'exported.m3u');
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }
}
