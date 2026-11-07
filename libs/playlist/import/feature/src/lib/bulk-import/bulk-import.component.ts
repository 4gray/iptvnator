import {
    Component,
    computed,
    inject,
    output,
    signal,
    ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import {
    BulkImportEntry,
    bulkEntriesFromJson,
    bulkEntryIssue,
    candidatesToBulkEntries,
    dedupeBulkCandidates,
    detectProviderImportCandidates,
    SOURCE_TYPE_ICONS,
    type BulkImportIssue,
    type ProviderImportKind,
} from '@iptvnator/shared/interfaces';
import {
    BulkImportRunnerService,
    type BulkImportRowStatus,
} from './bulk-import-runner.service';

const KIND_ICONS: Record<ProviderImportKind, string> = {
    xtream: SOURCE_TYPE_ICONS.xtream,
    stalker: SOURCE_TYPE_ICONS.stalker,
    'm3u-url': SOURCE_TYPE_ICONS['m3u-url'],
    'm3u-text': SOURCE_TYPE_ICONS['m3u-text'],
};

const KIND_LABEL_KEYS: Record<ProviderImportKind, string> = {
    xtream: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_LABEL',
    stalker: 'HOME.ADD_PLAYLIST.METHOD_STALKER_LABEL',
    'm3u-url': 'HOME.ADD_PLAYLIST.METHOD_URL_LABEL',
    'm3u-text': 'HOME.ADD_PLAYLIST.METHOD_TEXT_LABEL',
};

const ISSUE_LABEL_KEYS: Record<BulkImportIssue, string> = {
    'no-portal': 'HOME.ADD_PLAYLIST.BULK_ROW_NO_PORTAL',
    'no-mac': 'HOME.ADD_PLAYLIST.BULK_ROW_NO_MAC',
    'missing-details': 'HOME.ADD_PLAYLIST.BULK_ROW_MISSING_DETAILS',
};

const STATUS_LABEL_KEYS: Record<BulkImportRowStatus, string> = {
    pending: 'HOME.ADD_PLAYLIST.BULK_STATUS_PENDING',
    importing: 'HOME.ADD_PLAYLIST.BULK_STATUS_IMPORTING',
    imported: 'HOME.ADD_PLAYLIST.BULK_STATUS_IMPORTED',
    slow: 'HOME.ADD_PLAYLIST.BULK_STATUS_SLOW',
    failed: 'HOME.ADD_PLAYLIST.BULK_STATUS_FAILED',
};

/**
 * Bulk source import: everything the user wants is inside one file
 * (`.txt` of provider handouts, or `.json` with the explicit
 * `{ "sources": [...] }` shape — no free-text field). File content runs
 * through the same deterministic detection as the auto import. Each row
 * carries its own title plus Live/VOD scope toggles (VOD starts off), and
 * rows can be dropped before importing. Importing replaces every existing
 * source and imports the rows one at a time, each with its catalog seeded
 * under a per-source timeout (`BulkImportRunnerService`).
 */
@Component({
    selector: 'app-bulk-import',
    templateUrl: './bulk-import.component.html',
    styleUrl: './bulk-import.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatCheckboxModule, MatIcon, TranslatePipe],
})
export class BulkImportComponent {
    readonly imported = output<void>();

    private readonly runner = inject(BulkImportRunnerService);
    private readonly translate = inject(TranslateService);
    private readonly settingsStore = inject(SettingsStore);

    readonly entries = signal<BulkImportEntry[]>([]);
    /** Translated message; null when there is nothing to report. */
    readonly fileError = signal<string | null>(null);
    readonly loadedFileName = signal<string | null>(null);
    readonly isImporting = this.runner.running;

    readonly importableEntries = computed(() =>
        this.entries().filter((entry) => entry.valid)
    );
    readonly hasEntries = computed(() => this.entries().length > 0);
    /**
     * A file whose every row is unusable: the Import button is disabled, so
     * the dialog has to say why instead of looking like a dead button.
     */
    readonly nothingImportable = computed(
        () => this.hasEntries() && this.importableEntries().length === 0
    );
    /**
     * The global Disable VOD setting: rows show and import live only, and
     * keep their own VOD choice for when the setting is turned off.
     */
    readonly vodDisabled = computed(
        () => this.settingsStore.disableVod?.() === true
    );

    clearForm(): void {
        this.entries.set([]);
        this.fileError.set(null);
        this.loadedFileName.set(null);
    }

    async onFilePicked(input: HTMLInputElement): Promise<void> {
        const file = input.files?.[0];
        input.value = '';
        if (!file) {
            return;
        }
        this.fileError.set(null);
        let contents: string;
        try {
            contents = await file.text();
        } catch {
            this.fileError.set(
                this.translate.instant('HOME.FILE_UPLOAD.OPEN_FAILED', {
                    filename: file.name,
                })
            );
            return;
        }

        if (!this.parseSourceFile(contents)) {
            return;
        }
        this.loadedFileName.set(file.name);
    }

    setEntryTitle(id: string, title: string): void {
        this.patchEntry(id, { title });
    }

    setEntryLive(id: string, checked: boolean): void {
        const entry = this.entries().find((row) => row.id === id);
        if (!entry) {
            return;
        }
        // Same guard as the single-source scope picker: a source that
        // imports nothing is broken, so the last checked box stays on.
        this.patchEntry(id, { importLive: checked || !entry.importVod });
    }

    setEntryVod(id: string, checked: boolean): void {
        const entry = this.entries().find((row) => row.id === id);
        if (!entry) {
            return;
        }
        this.patchEntry(id, { importVod: checked || !entry.importLive });
    }

    removeEntry(id: string): void {
        this.entries.update((rows) => rows.filter((row) => row.id !== id));
    }

    kindIcon(kind: ProviderImportKind): string {
        return KIND_ICONS[kind];
    }

    kindLabelKey(kind: ProviderImportKind): string {
        return KIND_LABEL_KEYS[kind];
    }

    /** One-line masked summary; passwords are never rendered. */
    entrySummary(entry: BulkImportEntry): string {
        const candidate = entry.candidate;
        switch (candidate.kind) {
            case 'm3u-url':
                return candidate.url ?? '';
            case 'm3u-text':
                return this.translate.instant(
                    'HOME.ADD_PLAYLIST.METHOD_TEXT_LABEL'
                );
            case 'xtream':
                return [candidate.serverUrl, candidate.username]
                    .filter(Boolean)
                    .join(' · ');
            case 'stalker':
                return [candidate.portalUrl, candidate.macAddress]
                    .filter(Boolean)
                    .join(' · ');
        }
    }

    /**
     * Why a row cannot be imported, as a translation key; null when it can.
     * The row stays listed either way, so the user sees what the file held.
     */
    entryIssueKey(entry: BulkImportEntry): string | null {
        const issue = bulkEntryIssue(entry);
        return issue ? ISSUE_LABEL_KEYS[issue] : null;
    }

    /**
     * Replaces every existing source with the file's rows; see
     * {@link BulkImportRunnerService}. The dialog stays open with per-row
     * progress until the last source was tried.
     */
    async importAll(): Promise<void> {
        const rows = this.importableEntries();
        if (rows.length === 0 || this.isImporting()) {
            return;
        }
        const summary = await this.runner.run(rows);
        if (summary) {
            this.imported.emit();
        }
    }

    rowStatus(id: string): BulkImportRowStatus | null {
        return this.runner.statuses()[id] ?? null;
    }

    statusLabelKey(status: BulkImportRowStatus): string {
        return STATUS_LABEL_KEYS[status];
    }

    /**
     * Parses a picked file into preview rows. True when the content was a
     * parsable bulk list (empty valid-rows included); false when it should
     * be reported as unreadable.
     */
    private patchEntry(id: string, patch: Partial<BulkImportEntry>): void {
        this.entries.update((rows) =>
            rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
        );
    }

    private parseSourceFile(contents: string): boolean {
        this.fileError.set(null);
        this.loadedFileName.set(null);
        const trimmed = contents.trim();
        if (!trimmed) {
            this.fileError.set(
                this.translate.instant('HOME.ADD_PLAYLIST.BULK_NO_SOURCES')
            );
            return false;
        }
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                const parsed = bulkEntriesFromJson(JSON.parse(trimmed));
                if (!parsed) {
                    throw new Error('Not a bulk source list');
                }
                this.entries.set(parsed);
            } catch {
                this.entries.set([]);
                this.fileError.set(
                    this.translate.instant(
                        'HOME.ADD_PLAYLIST.BULK_INVALID_JSON'
                    )
                );
                return false;
            }
            return true;
        }
        this.entries.set(
            candidatesToBulkEntries(
                dedupeBulkCandidates(detectProviderImportCandidates(trimmed))
            )
        );
        return true;
    }
}
