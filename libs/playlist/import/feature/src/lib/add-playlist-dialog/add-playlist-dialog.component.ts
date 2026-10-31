import {
    afterRenderEffect,
    afterNextRender,
    Injector,
    Component,
    computed,
    DestroyRef,
    ElementRef,
    effect,
    inject,
    signal,
    ViewEncapsulation,
    viewChild,
    ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
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
import {
    DialogFooterDirective,
    DialogFooterStartDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';
import {
    RadioGroupDirective,
    RadioOptionDirective,
} from '@iptvnator/ui/components/radio-group';
import { PlaylistType } from '@iptvnator/playlist/shared/ui';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    ProviderImportCandidate,
    SOURCE_TYPE_ICONS,
} from '@iptvnator/shared/interfaces';
import { AutoImportComponent } from '../auto-import/auto-import.component';
import { FileUploadComponent } from '../file-upload/file-upload.component';
import { StalkerPortalImportComponent } from '../stalker-portal-import/stalker-portal-import.component';
import { TextImportComponent } from '../text-import/text-import.component';
import { UrlUploadComponent } from '../url-upload/url-upload.component';
import { UrlXtreamSuggestion } from '../url-upload/url-xtream-suggestion';
import { XtreamCodeImportComponent } from '../xtream-code-import/xtream-code-import.component';
import { createUrlPlaylistImport } from './url-playlist-import';
import { createImportDrafts } from './import-drafts';

/**
 * Flat connection-method model: each entry selects one form without nesting.
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
        RadioGroupDirective,
        RadioOptionDirective,
        AutoImportComponent,
        DialogFooterDirective,
        DialogFooterStartDirective,
        DialogShellComponent,
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
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
})
export class AddPlaylistDialogComponent {
    private readonly injector = inject(Injector);
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
    private readonly drafts = createImportDrafts({
        url: this.urlUpload,
        xtream: this.xtreamImport,
        stalker: this.stalkerImport,
        text: this.textImport,
        file: this.fileUpload,
    });

    readonly method = signal<PlaylistType>('url');
    readonly canReturnToM3u = signal(false);
    readonly urlImport = createUrlPlaylistImport();
    private readonly urlFeedback =
        viewChild<ElementRef<HTMLElement>>('urlFeedback');

    /**
     * Candidate picked in the auto-detect surface, waiting for its target
     * form to exist. Selecting a candidate switches `method`, which only
     * instantiates the target child on the NEXT change-detection pass — so
     * the prefill is applied by an effect that re-runs once the child's
     * viewChild signal resolves, then clears this.
     */
    private readonly pendingPrefill = signal<UrlXtreamSuggestion | null>(null);

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
            icon: SOURCE_TYPE_ICONS['m3u-url'],
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_URL_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_URL_SUB',
        },
        {
            value: 'file',
            icon: SOURCE_TYPE_ICONS['m3u-local'],
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_FILE_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_FILE_SUB',
        },
        {
            value: 'xtream',
            icon: SOURCE_TYPE_ICONS.xtream,
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_SUB',
        },
        {
            value: 'stalker',
            icon: SOURCE_TYPE_ICONS.stalker,
            labelKey: 'HOME.ADD_PLAYLIST.METHOD_STALKER_LABEL',
            subKey: 'HOME.ADD_PLAYLIST.METHOD_STALKER_SUB',
        },
        {
            value: 'text',
            icon: SOURCE_TYPE_ICONS['m3u-text'],
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
    readonly selectedMethod = computed(() =>
        this.methodOptions.find((option) => option.value === this.method())!
    );

    constructor() {
        if (this.data?.type) {
            this.method.set(this.data.type);
        }
        effect(() => {
            this.drafts.restore();
            this.applyPendingPrefill();
        });
        afterRenderEffect(() => {
            if (this.urlImport.errorKey())
                this.urlFeedback()?.nativeElement.scrollIntoView?.({
                    block: 'nearest',
                });
        });
        const cancel = () => {
            this.urlImport.cancel();
            this.stalkerImport()?.cancelPendingImport?.();
            this.drafts.clearAll();
        };
        inject(DestroyRef).onDestroy(cancel);
        this.dialogRef
            .beforeClosed()
            .pipe(takeUntilDestroyed())
            .subscribe(cancel);
        inject(Router, { optional: true })
            ?.events.pipe(takeUntilDestroyed())
            .subscribe((event) => {
                if (
                    event instanceof NavigationStart &&
                    (this.urlImport.pending() ||
                        this.stalkerImport()?.isLoading())
                ) {
                    this.closeDialog();
                }
            });
    }

    /**
     * Hands a detected source to the matching import form. Only prefills —
     * the user reviews and submits through the regular form, so validation
     * and the behavioral probes (portal discovery, connection test) stay in
     * charge of what actually gets persisted.
     */
    onCandidateSelected(candidate: UrlXtreamSuggestion, fromM3u = false): void {
        this.pendingPrefill.set(candidate);
        this.selectMethod(METHOD_BY_CANDIDATE_KIND[candidate.kind]);
        this.drafts.discard(METHOD_BY_CANDIDATE_KIND[candidate.kind]);
        this.canReturnToM3u.set(fromM3u);
        if (candidate.kind === 'xtream') {
            afterNextRender(() => this.xtreamImport()?.focusTitle(), {
                injector: this.injector,
            });
        }
    }

    backToM3u(): void {
        this.selectMethod('url');
        afterNextRender(() => this.urlUpload()?.focusUrl(), {
            injector: this.injector,
        });
    }

    selectMethod(method: PlaylistType): void {
        if (method === this.method()) return;
        this.drafts.capture(this.method());
        this.urlImport.cancel();
        this.urlImport.clearError();
        this.stalkerImport()?.cancelPendingImport?.();
        this.method.set(method);
        this.drafts.request(method);
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
                    ...(candidate.userAgent
                        ? { userAgent: candidate.userAgent }
                        : {}),
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
            filename
                ? this.translateService.instant('HOME.FILE_UPLOAD.REJECTED', {
                      filename,
                  })
                : this.translateService.instant(
                      'HOME.FILE_UPLOAD.REJECTED_UNNAMED'
                  )
        );
    }

    /**
     * Acquires a definition without import side effects. Only this dialog's
     * current operation may dispatch it; a failed acquisition keeps the draft.
     */
    async submitUrlPlaylist(): Promise<void> {
        const form = this.urlUpload()?.form;
        if (!form?.valid || this.urlImport.pending()) return;
        const draft = form.getRawValue();
        form.disable();
        await this.urlImport.submit(
            draft,
            () => this.closeDialog(),
            () => {
                void this.submitUrlPlaylist();
            }
        );
        form.enable();
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
        this.urlImport.clearError();
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
        if (this.urlImport.pending()) return true;
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
        this.drafts.clearAll();
        this.urlImport.cancel();
        this.stalkerImport()?.cancelPendingImport?.();
        this.dialogRef.close();
    }
}
