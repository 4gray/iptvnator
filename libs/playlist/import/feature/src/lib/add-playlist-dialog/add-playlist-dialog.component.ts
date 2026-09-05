import {
    Component,
    computed,
    effect,
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
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistType } from '@iptvnator/playlist/shared/ui';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService } from '@iptvnator/services';
import {
    PLAYLIST_PARSE_BY_URL,
    ProviderImportCandidate,
} from '@iptvnator/shared/interfaces';
import { AutoImportComponent } from '../auto-import/auto-import.component';
import { FileUploadComponent } from '../file-upload/file-upload.component';
import { StalkerPortalImportComponent } from '../stalker-portal-import/stalker-portal-import.component';
import { TextImportComponent } from '../text-import/text-import.component';
import { UrlUploadComponent } from '../url-upload/url-upload.component';
import { XtreamCodeImportComponent } from '../xtream-code-import/xtream-code-import.component';

/**
 * Flat 5-method option model — replaces the prior category × subtype matrix
 * (M3U/Xtream/Stalker × URL/File/Text) which created 9 combinations of which
 * only 5 were real. Now each entry IS a method, no nesting.
 */
export interface PlaylistMethodOption {
    value: PlaylistType;
    icon: string;
    labelKey: string;
    subKey: string;
}

/** The import form a picked auto-detect candidate prefills. */
const METHOD_BY_CANDIDATE_KIND: Record<
    ProviderImportCandidate['kind'],
    PlaylistType
> = {
    xtream: 'xtream',
    stalker: 'stalker',
    'm3u-url': 'url',
    'm3u-text': 'text',
};

@Component({
    imports: [
        AutoImportComponent,
        FileUploadComponent,
        MatButtonModule,
        MatDialogModule,
        MatIcon,
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
    readonly autoImport = viewChild(AutoImportComponent);

    readonly method = signal<PlaylistType>('url');

    /**
     * Candidate picked in the auto-detect surface, waiting for its target
     * form to exist. Selecting a candidate switches `method`, which only
     * instantiates the target child on the NEXT change-detection pass — so
     * the prefill is applied by an effect that re-runs once the child's
     * viewChild signal resolves, then clears this.
     */
    private readonly pendingPrefill =
        signal<ProviderImportCandidate | null>(null);

    /**
     * Survives the auto-detect surface being destroyed by a method switch, so
     * returning to it after inspecting a prefilled form keeps the paste.
     */
    readonly autoDetectText = signal('');

    // Order matches the v0.22 mockup left-to-right: URL first (Most common),
    // then File, Xtream credentials, Stalker portal, raw text paste. Each
    // entry stands on its own — no nested subtypes. Labels are short and
    // sentence-cased; the "Add via …" / "Add Xtreme Code" wording from the
    // old tab labels is redundant inside a dialog already titled "Add
    // playlist".
    readonly methodOptions: PlaylistMethodOption[] = [
        {
            value: 'url',
            icon: 'public',
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_URL_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_URL_SUB',
        },
        {
            value: 'file',
            icon: 'folder_open',
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_FILE_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_FILE_SUB',
        },
        {
            value: 'xtream',
            icon: 'vpn_key',
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_SUB',
        },
        {
            value: 'stalker',
            icon: 'cast',
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_STALKER_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_STALKER_SUB',
        },
        {
            value: 'text',
            icon: 'subject',
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_TEXT_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_TEXT_SUB',
        },
        {
            value: 'auto',
            icon: 'auto_awesome',
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_AUTO_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_AUTO_SUB',
        },
    ];

    /**
     * Backwards-compatible alias. The template's @switch and the action
     * buttons key off this; keeping the name avoids churn in 5 case branches.
     */
    readonly playlistType = computed<PlaylistType>(() => this.method());

    constructor() {
        if (this.data?.type) {
            this.method.set(this.data.type);
        }
        effect(() => this.applyPendingPrefill());
    }

    /**
     * Hands a detected source to the matching import form. Only prefills —
     * the user reviews and submits through the regular form, so validation
     * and the behavioral probes (portal discovery, connection test) stay in
     * charge of what actually gets persisted.
     */
    onCandidateSelected(candidate: ProviderImportCandidate): void {
        this.pendingPrefill.set(candidate);
        this.method.set(METHOD_BY_CANDIDATE_KIND[candidate.kind]);
    }

    private applyPendingPrefill(): void {
        const candidate = this.pendingPrefill();
        if (!candidate) {
            return;
        }
        // The user can click another method tile before the target form
        // mounts; a candidate must not lie in wait and prefill a later visit
        // to its form. Only the method the selection itself switched to may
        // consume it.
        if (this.method() !== METHOD_BY_CANDIDATE_KIND[candidate.kind]) {
            this.pendingPrefill.set(null);
            return;
        }
        switch (candidate.kind) {
            case 'm3u-url': {
                const child = this.urlUpload();
                if (!child) {
                    return;
                }
                child.form.patchValue({
                    playlistUrl: candidate.url ?? '',
                    playlistName: candidate.suggestedTitle ?? '',
                });
                break;
            }
            case 'm3u-text': {
                const child = this.textImport();
                if (!child) {
                    return;
                }
                child.textForm.patchValue({ text: candidate.text ?? '' });
                break;
            }
            case 'xtream': {
                const child = this.xtreamImport();
                if (!child) {
                    return;
                }
                child.form.patchValue({
                    title: candidate.suggestedTitle ?? '',
                    serverUrl: candidate.serverUrl ?? '',
                    username: candidate.username ?? '',
                    password: candidate.password ?? '',
                });
                break;
            }
            case 'stalker': {
                const child = this.stalkerImport();
                if (!child) {
                    return;
                }
                child.form.patchValue({
                    title: candidate.suggestedTitle ?? '',
                    portalUrl: candidate.portalUrl ?? '',
                    macAddress: candidate.macAddress ?? '',
                    serialNumber: candidate.serialNumber ?? '',
                    deviceId1: candidate.deviceId1 ?? '',
                    deviceId2: candidate.deviceId2 ?? '',
                    signature1: candidate.signature1 ?? '',
                    signature2: candidate.signature2 ?? '',
                    username: candidate.username ?? '',
                    password: candidate.password ?? '',
                });
                break;
            }
        }
        this.pendingPrefill.set(null);
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
    submitUrlPlaylist(): void {
        const formValue = this.urlUpload()?.form?.getRawValue();
        const playlistUrl = formValue?.playlistUrl?.trim();

        if (!playlistUrl) {
            return;
        }

        const playlistName = this.normalizeOptionalValue(
            formValue?.playlistName
        );

        const userAgent = this.normalizeOptionalValue(formValue?.userAgent);

        this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            url: playlistUrl,
            ...(playlistName ? { title: playlistName } : {}),
            ...(userAgent ? { userAgent } : {}),
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
            case 'auto':
                this.autoImport()?.clearForm();
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
}
