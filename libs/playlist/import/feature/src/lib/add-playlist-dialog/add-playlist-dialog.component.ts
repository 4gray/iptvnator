import {
    Component,
    computed,
    inject,
    signal,
    ViewEncapsulation,
    viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistType } from '@iptvnator/playlist/shared/ui';
import { SourceVpnPreparationService } from '@iptvnator/playlist/shared/util';
import { PlaylistActions } from 'm3u-state';
import { DataService } from 'services';
import {
    PLAYLIST_PARSE_BY_URL,
    PlaylistSourceVpnConfig,
    PROTON_VPN_LOCATION_OPTIONS,
} from 'shared-interfaces';
import { FileUploadComponent } from '../file-upload/file-upload.component';
import { StalkerPortalImportComponent } from '../stalker-portal-import/stalker-portal-import.component';
import { TextImportComponent } from '../text-import/text-import.component';
import { UrlUploadComponent } from '../url-upload/url-upload.component';
import { XtreamCodeImportComponent } from '../xtream-code-import/xtream-code-import.component';

type PlaylistCategory = 'm3u' | Extract<PlaylistType, 'xtream' | 'stalker'>;
type M3uSubType = Extract<PlaylistType, 'url' | 'file' | 'text'>;

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
        MatCheckboxModule,
        MatDialogModule,
        MatFormFieldModule,
        MatSelectModule,
        ReactiveFormsModule,
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
    private sourceVpnPreparation = inject(SourceVpnPreparationService);
    private translateService = inject(TranslateService);
    private data = inject<{ type?: PlaylistType } | null>(MAT_DIALOG_DATA, {
        optional: true,
    });

    readonly isDesktop = !!window.electron;
    readonly urlUpload = viewChild(UrlUploadComponent);
    readonly fileUpload = viewChild(FileUploadComponent);
    readonly textImport = viewChild(TextImportComponent);
    readonly xtreamImport = viewChild(XtreamCodeImportComponent);
    readonly stalkerImport = viewChild(StalkerPortalImportComponent);

    readonly category = signal<PlaylistCategory>('m3u');
    readonly m3uSubType = signal<M3uSubType>('url');
    readonly vpnLocationOptions = PROTON_VPN_LOCATION_OPTIONS;
    readonly vpnProviderOptions = [
        {
            value: 'proton',
            labelKey: 'SETTINGS.VPN_PROVIDER_PROTON',
        },
    ] as const;
    readonly sourceVpnForm = new FormGroup({
        vpnProvider: new FormControl<'proton'>('proton', {
            nonNullable: true,
        }),
        vpnLocation: new FormControl('FASTEST', { nonNullable: true }),
        vpnAutoConnectOnOpen: new FormControl(false, { nonNullable: true }),
        vpnAutoConnectWhenDefault: new FormControl(false, {
            nonNullable: true,
        }),
    });

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
     * Closes the dialog after a successful file import. The actual parse and
     * dispatch happens inside `PlaylistFileImportService` (called from the
     * `FileUploadComponent`).
     */
    onFileImported(): void {
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
    async submitUrlPlaylist(): Promise<void> {
        const formValue = this.urlUpload()?.form?.getRawValue();
        const playlistUrl = formValue?.playlistUrl?.trim();

        if (!playlistUrl) {
            return;
        }

        const playlistName = this.normalizeOptionalValue(
            formValue?.playlistName
        );
        const sourceVpn = this.getSourceVpnConfig();

        await this.prepareSourceVpnForImport(
            playlistName ?? playlistUrl,
            sourceVpn
        );

        this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            url: playlistUrl,
            ...(playlistName ? { title: playlistName } : {}),
            ...(sourceVpn ?? {}),
        });
        this.closeDialog();
    }

    /**
     * Sends IPC event to the renderer process to parse playlist
     * @param text playlist as string
     */
    uploadAsText(playlist: string): void {
        const sourceVpn = this.getSourceVpnConfig();
        this.store.dispatch(
            PlaylistActions.parsePlaylist({
                uploadType: 'TEXT',
                playlist,
                title: this.translateService.instant('HOME.IMPORTED_AS_TEXT'),
                ...(sourceVpn ? { sourceVpn } : {}),
            })
        );
        this.closeDialog();
    }

    clearCurrentForm(): void {
        switch (this.playlistType()) {
            case 'url':
                this.urlUpload()?.clearForm();
                break;
            case 'file':
                this.fileUpload()?.clearSelection();
                break;
            case 'text':
                this.textImport()?.clearForm();
                break;
            case 'xtream':
                this.xtreamImport()?.clearForm();
                break;
            case 'stalker':
                this.stalkerImport()?.clearForm();
                break;
        }
    }

    isClearDisabled(): boolean {
        switch (this.playlistType()) {
            case 'file':
                return (
                    !this.fileUpload()?.selectedFile() ||
                    !!this.fileUpload()?.isImporting()
                );
            case 'xtream':
                return !!this.xtreamImport()?.isTestingConnection;
            case 'stalker':
                return !!this.stalkerImport()?.isLoading();
            default:
                return false;
        }
    }

    closeDialog(): void {
        this.dialogRef.close();
    }

    private normalizeOptionalValue(value?: string | null): string | undefined {
        const normalizedValue = value?.trim();
        return normalizedValue ? normalizedValue : undefined;
    }

    private async prepareSourceVpnForImport(
        title: string,
        sourceVpn: PlaylistSourceVpnConfig | undefined
    ): Promise<void> {
        if (!sourceVpn) {
            return;
        }

        await this.sourceVpnPreparation.prepareForPlaylist(
            {
                _id: `import-${this.playlistType()}`,
                title,
                count: 0,
                autoRefresh: false,
                importDate: new Date().toISOString(),
                ...sourceVpn,
            },
            'source-open'
        );
    }

    getSourceVpnConfig(): PlaylistSourceVpnConfig | undefined {
        if (!this.isDesktop) {
            return undefined;
        }

        const value = this.sourceVpnForm.getRawValue();
        const vpnLocation = value.vpnLocation?.trim() || 'FASTEST';
        const shouldPersist =
            value.vpnAutoConnectOnOpen ||
            value.vpnAutoConnectWhenDefault ||
            vpnLocation !== 'FASTEST';

        if (!shouldPersist) {
            return undefined;
        }

        return {
            vpnProvider: 'proton',
            vpnLocation,
            vpnAutoConnectOnOpen: value.vpnAutoConnectOnOpen,
            vpnAutoConnectWhenDefault: value.vpnAutoConnectWhenDefault,
        };
    }
}
