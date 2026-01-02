import { Injectable, signal, computed } from '@angular/core';

export interface EpgImportProgress {
    url: string;
    status: 'queued' | 'loading' | 'complete' | 'error';
    stats?: { totalChannels: number; totalPrograms: number };
    error?: string;
    queuePosition?: number;
}

/**
 * Service to track EPG import progress across multiple sources.
 * Uses signals for reactive state management.
 */
@Injectable({ providedIn: 'root' })
export class EpgProgressService {
    private _imports = signal<Map<string, EpgImportProgress>>(new Map());
    private _initialized = false;

    /** All current import progress entries */
    readonly imports = computed(() => Array.from(this._imports().values()));

    /** Whether any imports are currently loading */
    readonly hasActiveImports = computed(() =>
        this.imports().some((i) => i.status === 'loading')
    );

    /** Count of active imports */
    readonly activeCount = computed(() =>
        this.imports().filter((i) => i.status === 'loading').length
    );

    /** Queued imports waiting to be processed */
    readonly queuedImports = computed(() =>
        this.imports()
            .filter((i) => i.status === 'queued')
            .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0))
    );

    /** Count of queued imports */
    readonly queuedCount = computed(() => this.queuedImports().length);

    /** Whether the panel should be visible */
    readonly isVisible = computed(() => this.imports().length > 0);

    constructor() {
        this.initializeListener();
    }

    private initializeListener(): void {
        if (this._initialized) return;
        this._initialized = true;

        // Listen for EPG progress updates from Electron
        if (window.electron?.onEpgProgress) {
            window.electron.onEpgProgress((data) => {
                this.updateProgress(data);
            });
        }
    }

    private updateProgress(progress: EpgImportProgress): void {
        this._imports.update((current) => {
            const updated = new Map(current);
            updated.set(progress.url, progress);
            return updated;
        });

        // Auto-remove completed/error entries after delay
        if (progress.status === 'complete' || progress.status === 'error') {
            setTimeout(() => this.removeImport(progress.url), 5000);
        }
    }

    private removeImport(url: string): void {
        this._imports.update((current) => {
            const updated = new Map(current);
            updated.delete(url);
            return updated;
        });
    }

    /** Manually dismiss an import notification */
    dismiss(url: string): void {
        this.removeImport(url);
    }

    /** Dismiss all notifications */
    dismissAll(): void {
        this._imports.set(new Map());
    }
}
