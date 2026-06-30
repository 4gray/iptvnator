import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EpgRuntimeBridgeService, EpgService } from '@iptvnator/epg/data-access';
import { TranslatePipe } from '@ngx-translate/core';
import { debounceTime, from, Subject, switchMap } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

export interface EpgMappingDialogData {
    channelKey: string;
    channelName: string;
    currentMapping: string | null;
}

export interface EpgMappingDialogResult {
    channelKey: string;
    epgChannelId: string;
}

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

    readonly searchTerm = signal('');
    readonly loading = signal(false);
    readonly results = signal<
        Array<{ id: string; displayName: string; iconUrl: string | null }>
    >([]);
    readonly selectedId = signal<string | null>(null);
    readonly currentMapping = signal<string | null>(null);

    private readonly search$ = new Subject<string>();

    constructor() {
        // Fetch the current mapping (if any) on open — callers may not know it.
        this.epgBridge
            .getEpgMapping(this.data.channelKey)
            ?.then((m) => this.currentMapping.set(m?.epgChannelId ?? null));

        this.search$
            .pipe(
                debounceTime(300),
                switchMap((term) => {
                    if (term.trim().length < 2) {
                        return from(Promise.resolve([]));
                    }
                    this.loading.set(true);
                    const promise = this.epgBridge.searchEpgChannels(term);
                    return from(promise ?? Promise.resolve([]));
                })
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
        () => this.searchTerm().trim().length >= 2
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

        (this.epgBridge.setEpgMapping(this.data.channelKey, epgChannelId) ??
            Promise.resolve(null))
            .then((result) => {
                if (result?.success === false) return;
                this.epgService.clearCache();
                this.dialogRef.close({
                    channelKey: this.data.channelKey,
                    epgChannelId,
                });
            });
    }

    removeMapping(): void {
        (this.epgBridge.deleteEpgMapping(this.data.channelKey) ??
            Promise.resolve(null))
            .then((result) => {
                if (result?.success === false) return;
                this.epgService.clearCache();
                this.dialogRef.close();
            });
    }

    close(): void {
        this.dialogRef.close();
    }
}
