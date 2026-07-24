import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EpgRuntimeBridgeService, EpgService } from '@iptvnator/epg/data-access';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, from, Subject, switchMap } from 'rxjs';

export interface EpgMappingDialogData {
    channelKey: string;
    channelName: string;
    /** Owning playlist for portal channels; omitted for M3U lookup keys. */
    playlistId?: string | null;
}

export interface EpgMappingDialogResult {
    channelKey: string;
    epgChannelId: string;
}

const SEARCH_MIN_CHARS = 2;

@Component({
    selector: 'app-epg-mapping-dialog',
    templateUrl: './epg-mapping-dialog.component.html',
    styleUrl: './epg-mapping-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        MatButtonModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatProgressSpinnerModule,
        TranslatePipe,
    ],
})
export class EpgMappingDialogComponent {
    readonly data = inject<EpgMappingDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(
        MatDialogRef<EpgMappingDialogComponent, EpgMappingDialogResult>
    );
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly epgService = inject(EpgService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    readonly searchMinChars = SEARCH_MIN_CHARS;
    readonly searchTerm = signal('');
    readonly loading = signal(false);
    readonly results = signal<
        Array<{ id: string; displayName: string; iconUrl: string | null }>
    >([]);
    readonly selectedId = signal<string | null>(null);
    readonly currentMapping = signal<string | null>(null);

    private readonly search$ = new Subject<string>();

    /** Open the dialog with the shared sizing used by every caller. */
    static open(
        dialog: MatDialog,
        data: EpgMappingDialogData
    ): MatDialogRef<EpgMappingDialogComponent, EpgMappingDialogResult> {
        return dialog.open(EpgMappingDialogComponent, {
            data,
            width: '500px',
            maxHeight: '90vh',
        });
    }

    constructor() {
        // Fetch the current mapping (if any) on open — callers don't know it.
        this.loadCurrentMapping();

        this.search$
            .pipe(
                debounceTime(300),
                switchMap((term) => {
                    if (term.trim().length < SEARCH_MIN_CHARS) {
                        return from(Promise.resolve([]));
                    }
                    this.loading.set(true);
                    const promise = this.epgBridge.searchEpgChannels(term);
                    return from(promise ?? Promise.resolve([]));
                }),
                takeUntilDestroyed()
            )
            .subscribe({
                next: (items) => {
                    this.results.set(items ?? []);
                    this.loading.set(false);
                },
                error: () => {
                    this.results.set([]);
                    this.loading.set(false);
                },
            });
    }

    readonly hasSearchTerm = computed(
        () => this.searchTerm().trim().length >= SEARCH_MIN_CHARS
    );

    onSearchInput(value: string): void {
        this.searchTerm.set(value);
        this.search$.next(value);
    }

    selectChannel(id: string): void {
        this.selectedId.set(id);
    }

    save(): void {
        const epgChannelId = this.selectedId();
        if (!epgChannelId) return;

        this.epgBridge
            .setEpgMapping(
                this.data.channelKey,
                epgChannelId,
                this.data.playlistId ?? undefined
            )
            .then((result) => {
                if (!result?.success) {
                    this.notify('EPG_MAPPING_DIALOG.SAVE_FAILED');
                    return;
                }
                this.epgService.clearCache();
                this.notify('EPG_MAPPING_DIALOG.SAVED');
                this.dialogRef.close({
                    channelKey: this.data.channelKey,
                    epgChannelId,
                });
            });
    }

    removeMapping(): void {
        this.epgBridge.deleteEpgMapping(this.data.channelKey).then((result) => {
            if (!result?.success) {
                this.notify('EPG_MAPPING_DIALOG.SAVE_FAILED');
                return;
            }
            this.epgService.clearCache();
            this.notify('EPG_MAPPING_DIALOG.REMOVED');
            this.dialogRef.close();
        });
    }

    close(): void {
        this.dialogRef.close();
    }

    /**
     * Resolve the stored mapping and enrich it with the EPG channel's
     * display name so the user sees "BBC One (bbc.one.uk)" instead of a
     * bare ID.
     */
    private loadCurrentMapping(): void {
        this.epgBridge.getEpgMapping(this.data.channelKey).then(async (m) => {
            const mappedId = m?.epgChannelId ?? null;
            if (!mappedId) {
                this.currentMapping.set(null);
                return;
            }
            this.currentMapping.set(mappedId);
            try {
                const matches =
                    (await this.epgBridge.searchEpgChannels(mappedId, 10)) ??
                    [];
                const exact = matches.find((r) => r.id === mappedId);
                if (exact?.displayName && exact.displayName !== mappedId) {
                    this.currentMapping.set(
                        `${exact.displayName} (${mappedId})`
                    );
                }
            } catch {
                // Display name enrichment is cosmetic — keep the bare ID.
            }
        });
    }

    private notify(key: string): void {
        this.snackBar.open(this.translate.instant(key), undefined, {
            duration: 2000,
        });
    }
}
