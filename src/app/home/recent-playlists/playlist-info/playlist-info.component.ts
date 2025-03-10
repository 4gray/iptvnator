/* eslint-disable @typescript-eslint/unbound-method */
import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, Inject } from '@angular/core';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { firstValueFrom } from 'rxjs';
import { Playlist } from '../../../../../shared/playlist.interface';
import { DatabaseService } from '../../../services/database.service';
import { PlaylistsService } from '../../../services/playlists.service';
import { PlaylistMeta } from '../../../shared/playlist-meta.type';
import * as PlaylistActions from '../../../state/actions';
import { XtreamStore } from '../../../xtream-tauri/xtream.store';

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
    providers: [DatePipe, XtreamStore],
    imports: [
        CommonModule,
        MatButtonModule,
        MatCheckboxModule,
        MatDialogModule,
        MatIconModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
})
export class PlaylistInfoComponent {
    isTauri = isTauri();

    /** Playlist object */
    playlist: Playlist & { id: string };

    /** Form group with playlist details */
    playlistDetails: UntypedFormGroup;
    xtreamStore = inject(XtreamStore);

    constructor(
        private datePipe: DatePipe,
        private formBuilder: UntypedFormBuilder,
        private playlistsService: PlaylistsService,
        @Inject(MAT_DIALOG_DATA) public playlistData: Playlist & { id: string },
        private store: Store,
        private databaseService: DatabaseService,
        private snackBar: MatSnackBar,
        private translate: TranslateService
    ) {
        this.playlist = playlistData;
        this.createForm();
    }

    /**
     * Create the form and set initial data on component init
     */
    createForm(): void {
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

    async saveChanges(playlist: PlaylistMeta): Promise<void> {
        try {
            const isXtream =
                this.playlist &&
                this.playlist.username &&
                this.playlist.password &&
                this.playlist.serverUrl;

            if (isXtream) {
                await this.updateXtreamPlaylist(playlist);
            }

            // Dispatch store action to update UI
            this.store.dispatch(
                PlaylistActions.updatePlaylistMeta({ playlist })
            );

            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                this.translate.instant('CLOSE'),
                { duration: 3000 }
            );
        } catch (error) {
            console.error('Error updating playlist:', error);
            this.snackBar.open(
                this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED'),
                this.translate.instant('CLOSE'),
                {
                    duration: 3000,
                }
            );
        }
    }

    async updateXtreamPlaylist(playlist: PlaylistMeta) {
        const success = await this.databaseService.updateXtreamPlaylistDetails({
            id: this.playlist._id,
            title: playlist.title,
            username: playlist.username,
            password: playlist.password,
            serverUrl: playlist.serverUrl,
        });

        if (!success) {
            throw new Error('Failed to update playlist in database');
        }

        this.xtreamStore.updatePlaylist({
            name: playlist.title,
            username: playlist.username,
            password: playlist.password,
            serverUrl: playlist.serverUrl,
        });
    }

    async exportPlaylist() {
        const playlistAsString = await firstValueFrom(
            this.playlistsService.getRawPlaylistById(this.playlist._id)
        );

        if (this.isTauri) {
            try {
                const savePath = await save({
                    filters: [
                        {
                            name: 'Playlist',
                            extensions: ['m3u8'],
                        },
                    ],
                    defaultPath: `${this.playlist.title || 'exported'}.m3u8`,
                });

                if (savePath) {
                    await writeTextFile(savePath, playlistAsString);
                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.INFO_DIALOG.PLAYLIST_EXPORT_SUCCESS'
                        ),
                        this.translate.instant('CLOSE'),
                        { duration: 3000 }
                    );
                }
            } catch (error) {
                console.error('Failed to export playlist:', error);
                this.snackBar.open(
                    this.translate.instant(
                        'HOME.PLAYLISTS.INFO_DIALOG.EXPORT_PLAYLIST_FAILED'
                    ),
                    this.translate.instant('CLOSE'),
                    {
                        duration: 3000,
                    }
                );
            }
        } else {
            const element = document.createElement('a');
            element.setAttribute(
                'href',
                'data:text/plain;charset=utf-8,' +
                    encodeURIComponent(playlistAsString)
            );
            element.setAttribute(
                'download',
                this.playlist.title || 'exported.m3u'
            );
            element.style.display = 'none';
            document.body.appendChild(element);
            element.click();
            document.body.removeChild(element);
        }
    }
}
