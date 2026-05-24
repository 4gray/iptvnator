import { Injectable, computed, inject, signal } from '@angular/core';
import {
    EpgImportProgress,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';

@Injectable({ providedIn: 'root' })
export class EpgProgressService {
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly importsMap = signal<Map<string, EpgImportProgress>>(
        new Map()
    );
    private initialized = false;

    readonly imports = computed(() => Array.from(this.importsMap().values()));
    readonly hasActiveImports = computed(() =>
        this.imports().some((item) => item.status === 'loading')
    );
    readonly activeCount = computed(
        () => this.imports().filter((item) => item.status === 'loading').length
    );
    readonly queuedImports = computed(() =>
        this.imports()
            .filter((item) => item.status === 'queued')
            .sort(
                (a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0)
            )
    );
    readonly queuedCount = computed(() => this.queuedImports().length);
    readonly isVisible = computed(() => this.imports().length > 0);

    constructor() {
        this.initializeListener();
    }

    dismiss(url: string): void {
        this.removeImport(url);
    }

    dismissAll(): void {
        this.importsMap.set(new Map());
    }

    retry(url: string): void {
        // Clear the errored row so the backend's subsequent 'queued' event
        // reappears cleanly rather than updating an existing error row.
        this.removeImport(url);
        if (!this.epgBridge.supportsDataManagement) {
            return;
        }
        void this.epgBridge.forceFetchEpg(url);
    }

    private initializeListener(): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        if (this.epgBridge.supportsProgress) {
            this.epgBridge.onProgress((data) => {
                this.updateProgress(data);
            });
        }
    }

    private updateProgress(progress: EpgImportProgress): void {
        this.importsMap.update((current) => {
            const updated = new Map(current);
            updated.set(progress.url, progress);
            return updated;
        });

        if (progress.status === 'complete' || progress.status === 'error') {
            setTimeout(() => this.removeImport(progress.url), 5000);
        }
    }

    private removeImport(url: string): void {
        this.importsMap.update((current) => {
            const updated = new Map(current);
            updated.delete(url);
            return updated;
        });
    }
}
