import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
    FormControl,
    ReactiveFormsModule,
    UntypedFormBuilder,
    UntypedFormGroup,
    Validators,
} from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import * as PlaylistActions from 'm3u-state';
import { firstValueFrom } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import { Playlist, PlaylistMeta } from 'shared-interfaces';

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
        ClipboardModule,
        MatButton,
        MatCheckboxModule,
        MatDialogModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatTooltip,
        ReactiveFormsModule,
        TranslatePipe,
    ],
})
export class PlaylistInfoComponent {
    private clipboard = inject(Clipboard);
    private datePipe = inject(DatePipe);
    private formBuilder = inject(UntypedFormBuilder);
    private playlistsService = inject(PlaylistsService);
    private store = inject(Store);
    private databaseService = inject(DatabaseService);
    private snackBar = inject(MatSnackBar);
    private translate = inject(TranslateService);
    public playlistData = inject<Playlist & { id: string }>(MAT_DIALOG_DATA);

    readonly isDesktop = !!window.electron;

    /** Playlist object */
    playlist: Playlist & { id: string };

    /** Form group with playlist details */
    playlistDetails!: UntypedFormGroup;

    constructor() {
        this.playlist = this.playlistData;
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

        // TODO: circular dependency
        /* this.xtreamStore.updatePlaylist({
            name: playlist.title,
            username: playlist.username,
            password: playlist.password,
            serverUrl: playlist.serverUrl,
        }); */
    }

    async exportPlaylist() {
        const playlistAsString = await firstValueFrom(
            this.playlistsService.getRawPlaylistById(this.playlist._id)
        );

        if (this.isDesktop) {
            try {
                const savePath = await window.electron.saveFileDialog(
                    `${this.playlist.title || 'exported'}.m3u8`,
                    [
                        {
                            name: 'Playlist',
                            extensions: ['m3u8', 'm3u'],
                        },
                    ]
                );

                if (savePath) {
                    await window.electron.writeFile(savePath, playlistAsString);
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

    /**
     * Copy URL to clipboard
     */
    copyUrl(): void {
        const url = this.playlistDetails.get('url')?.value;
        if (url) {
            const success = this.clipboard.copy(url);
            if (success) {
                this.snackBar.open(
                    this.translate.instant('HOME.PLAYLISTS.INFO_DIALOG.URL_COPIED'),
                    this.translate.instant('CLOSE'),
                    { duration: 2000 }
                );
            }
        }
    }
}
