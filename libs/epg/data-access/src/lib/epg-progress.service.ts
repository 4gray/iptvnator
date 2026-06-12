import { Injectable, computed, inject, signal } from '@angular/core';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    normalizeHost,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import {
    EpgImportProgress,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';

@Injectable({ providedIn: 'root' })
export class EpgProgressService {
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);
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
            .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0))
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
        void this.epgBridge.forceFetchEpg(
            url,
            this.settingsStore.getTrustOptions()
        );
    }

    async trustPrivateNetworkSourceAndRetry(url: string): Promise<void> {
        const settings = this.settingsStore.getSettings();
        const trustedUrls = new Set(
            settings.trustedPrivateNetworkEpgUrls ?? []
        );
        trustedUrls.add(url.trim());

        await this.settingsStore.updateSettings({
            trustedPrivateNetworkEpgUrls: Array.from(trustedUrls),
        });
        this.retry(url);
    }

    async trustInsecureTlsHostAndRetry(
        url: string,
        host?: string
    ): Promise<void> {
        const trustedHost = host ?? this.getHostname(url);
        if (!trustedHost) {
            return;
        }

        const settings = this.settingsStore.getSettings();
        const trustedHosts = new Set(
            (settings.trustedInsecureTlsHosts ?? []).map((item) =>
                normalizeHost(item)
            )
        );
        trustedHosts.add(normalizeHost(trustedHost));

        await this.settingsStore.updateSettings({
            trustedInsecureTlsHosts: Array.from(trustedHosts),
        });
        this.retry(url);
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

        if (
            progress.status === 'complete' ||
            (progress.status === 'error' && !this.isActionableError(progress))
        ) {
            setTimeout(() => this.removeImport(progress.url), 5000);
        }
    }

    private isActionableError(progress: EpgImportProgress): boolean {
        return (
            progress.errorCode ===
                ELECTRON_BRIDGE_SECURITY_ERROR_CODES.EpgPrivateNetworkBlocked ||
            progress.errorCode ===
                ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate
        );
    }

    private getHostname(url: string): string | undefined {
        try {
            return new URL(url).hostname;
        } catch {
            return undefined;
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
