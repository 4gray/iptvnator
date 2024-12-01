import { Component, Inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PLAYLIST_PARSE_BY_URL } from '../../../../../shared/ipc-commands';
import { getFilenameFromUrl } from '../../../../../shared/playlist.utils';
import { FileUploadComponent } from '../../../home/file-upload/file-upload.component';
import { StalkerPortalImportComponent } from '../../../home/stalker-portal-import/stalker-portal-import.component';
import { TextImportComponent } from '../../../home/text-import/text-import.component';
import { UrlUploadComponent } from '../../../home/url-upload/url-upload.component';
import { XtreamCodeImportComponent } from '../../../home/xtream-code-import/xtream-code-import.component';
import { DataService } from '../../../services/data.service';
import { parsePlaylist } from '../../../state/actions';

export type PlaylistType = 'xtream' | 'url' | 'text' | 'file' | 'stalker';

@Component({
    standalone: true,
    imports: [
        MatButtonModule,
        MatDialogModule,
        TranslateModule,
        FileUploadComponent,
        XtreamCodeImportComponent,
        StalkerPortalImportComponent,
        TextImportComponent,
        UrlUploadComponent,
    ],
    selector: 'app-add-playlist',
    templateUrl: './add-playlist-dialog.component.html',
})
export class AddPlaylistDialogComponent {
    playlistType!: PlaylistType;

    constructor(
        @Inject(MAT_DIALOG_DATA) data: { type: PlaylistType },
        private dataService: DataService,
        private dialogRef: MatDialogRef<AddPlaylistDialogComponent>,
        private store: Store,
        private snackBar: MatSnackBar,
        private translateService: TranslateService
    ) {
        this.playlistType = data.type;
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
