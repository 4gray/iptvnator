import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { parsePlaylist } from 'm3u-state';
import { getFilenameFromUrl } from 'm3u-utils';
import { DataService } from 'services';
import { PLAYLIST_PARSE_BY_URL } from 'shared-interfaces';
import { FileUploadComponent } from '../../../home/file-upload/file-upload.component';
import { StalkerPortalImportComponent } from '../../../home/stalker-portal-import/stalker-portal-import.component';
import { TextImportComponent } from '../../../home/text-import/text-import.component';
import { UrlUploadComponent } from '../../../home/url-upload/url-upload.component';
import { XtreamCodeImportComponent } from '../../../home/xtream-code-import/xtream-code-import.component';

export type PlaylistType = 'xtream' | 'url' | 'text' | 'file' | 'stalker';

@Component({
    imports: [
        FileUploadComponent,
        MatButtonModule,
        MatDialogModule,
        StalkerPortalImportComponent,
        TextImportComponent,
        TranslateModule,
        UrlUploadComponent,
        XtreamCodeImportComponent,
    ],
    selector: 'app-add-playlist',
    templateUrl: './add-playlist-dialog.component.html',
})
export class AddPlaylistDialogComponent {
    private dataService = inject(DataService);
    private dialogRef = inject(MatDialogRef<AddPlaylistDialogComponent>);
    private store = inject(Store);
    private snackBar = inject(MatSnackBar);
    private translateService = inject(TranslateService);
    readonly data = inject<{ type: PlaylistType }>(MAT_DIALOG_DATA);

    readonly playlistType!: PlaylistType;

    constructor() {
        this.playlistType = this.data.type;
    }

    /**
     * Parse and store uploaded playlist
     * @param payload
     */
    handlePlaylist(payload: { uploadEvent: Event; file: File }): void {
        const playlist = (payload.uploadEvent.target as FileReader)
            .result as string;

        this.store.dispatch(
            parsePlaylist({
                uploadType: 'FILE',
                playlist,
                title: payload.file.name,
                path: (payload.file as any).path,
            })
        );
        this.closeDialog();
    }

    rejectFile(filename: string): void {
        this.snackBar.open(
            this.translateService.instant('HOME.FILE_UPLOAD.REJECTED', {
                filename,
            })
        );
    }

    /**
     * Sends url of the playlist to the renderer process
     * @param playlistUrl url of the added playlist
     */
    sendPlaylistsUrl(playlistUrl: string): void {
        this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            title: getFilenameFromUrl(playlistUrl),
            url: playlistUrl,
        });
        this.closeDialog();
    }

    /**
     * Sends IPC event to the renderer process to parse playlist
     * @param text playlist as string
     */
    uploadAsText(playlist: string): void {
        this.store.dispatch(
            parsePlaylist({
                uploadType: 'TEXT',
                playlist,
                title: this.translateService.instant('HOME.IMPORTED_AS_TEXT'),
            })
        );
        this.closeDialog();
    }

    closeDialog() {
        this.dialogRef.close();
    }
}
