import {
    Component,
    computed,
    inject,
    signal,
    ViewEncapsulation,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistType } from '@iptvnator/playlist/shared/ui';
import {
    M3uSubType,
    PlaylistCategory,
} from '@iptvnator/workspace/shell/util';
import { PlaylistActions } from 'm3u-state';
import { DataService } from 'services';
import { PLAYLIST_PARSE_BY_URL } from 'shared-interfaces';
import { FileUploadComponent } from '../file-upload/file-upload.component';
import { StalkerPortalImportComponent } from '../stalker-portal-import/stalker-portal-import.component';
import { TextImportComponent } from '../text-import/text-import.component';
import { UrlUploadComponent } from '../url-upload/url-upload.component';
import { XtreamCodeImportComponent } from '../xtream-code-import/xtream-code-import.component';

interface CategoryOption {
    value: PlaylistCategory;
    label: string;
}

interface SubtypeOption {
    value: M3uSubType;
    labelKey: string;
}

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
    styleUrl: './add-playlist-dialog.component.scss',
    encapsulation: ViewEncapsulation.None,
})
export class AddPlaylistDialogComponent {
    private dataService = inject(DataService);
    private dialogRef = inject(MatDialogRef<AddPlaylistDialogComponent>);
    private store = inject(Store);
    private snackBar = inject(MatSnackBar);
    private translateService = inject(TranslateService);
    private data = inject<{ type?: PlaylistType } | null>(MAT_DIALOG_DATA, {
        optional: true,
    });

    readonly urlUpload = viewChild(UrlUploadComponent);
    readonly fileUpload = viewChild(FileUploadComponent);
    readonly textImport = viewChild(TextImportComponent);
    readonly xtreamImport = viewChild(XtreamCodeImportComponent);
    readonly stalkerImport = viewChild(StalkerPortalImportComponent);

    readonly category = signal<PlaylistCategory>('m3u');
    readonly m3uSubType = signal<M3uSubType>('url');

    readonly categoryOptions: CategoryOption[] = [
        { value: 'm3u', label: 'M3U' },
        { value: 'xtream', label: 'Xtream' },
        { value: 'stalker', label: 'Stalker' },
    ];

    readonly subtypeOptions: SubtypeOption[] = [
        { value: 'url', labelKey: 'HOME.TABS.URL_UPLOAD' },
        { value: 'file', labelKey: 'HOME.TABS.FILE_UPLOAD' },
        { value: 'text', labelKey: 'HOME.TABS.TEXT_IMPORT' },
    ];

    readonly playlistType = computed<PlaylistType>(() => {
        const cat = this.category();
        if (cat === 'xtream') return 'xtream';
        if (cat === 'stalker') return 'stalker';
        return this.m3uSubType();
    });

    constructor() {
        if (this.data?.type) {
            this.initFromType(this.data.type);
        }
    }

    private initFromType(type: PlaylistType): void {
        if (type === 'xtream') {
            this.category.set('xtream');
        } else if (type === 'stalker') {
            this.category.set('stalker');
        } else {
            this.category.set('m3u');
            this.m3uSubType.set(type as M3uSubType);
        }
    }

    /**
     * Parse and store uploaded playlist
     * @param payload
     */
    handlePlaylist(payload: { uploadEvent: Event; file: File }): void {
        const playlist = (payload.uploadEvent.target as FileReader)
            .result as string;

        this.store.dispatch(
            PlaylistActions.parsePlaylist({
                uploadType: 'FILE',
                playlist,
                title: payload.file.name,
                path: (payload.file as File & { path?: string }).path,
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
     * Sends url of the playlist to the renderer process and preserves the
     * existing fallback title behavior when the optional name is blank.
     */
    submitUrlPlaylist(): void {
        const formValue = this.urlUpload()?.form?.getRawValue();
        const playlistUrl = formValue?.playlistUrl?.trim();

        if (!playlistUrl) {
            return;
        }

        const playlistName = this.normalizeOptionalValue(formValue?.playlistName);

        this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            url: playlistUrl,
            ...(playlistName ? { title: playlistName } : {}),
        });
        this.closeDialog();
    }

    /**
     * Sends IPC event to the renderer process to parse playlist
     * @param text playlist as string
     */
    uploadAsText(playlist: string): void {
        this.store.dispatch(
            PlaylistActions.parsePlaylist({
                uploadType: 'TEXT',
                playlist,
                title: this.translateService.instant('HOME.IMPORTED_AS_TEXT'),
            })
        );
        this.closeDialog();
    }

    closeDialog(): void {
        this.dialogRef.close();
    }

    private normalizeOptionalValue(value?: string | null): string | undefined {
        const normalizedValue = value?.trim();
        return normalizedValue ? normalizedValue : undefined;
    }
}
