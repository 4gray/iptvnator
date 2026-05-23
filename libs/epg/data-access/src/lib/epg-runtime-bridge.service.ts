import { inject, Injectable } from '@angular/core';
import {
    EpgChannel,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';

export const EPG_IMPORT_STATUS = {
    Complete: 'complete',
    Error: 'error',
    Loading: 'loading',
    Queued: 'queued',
} as const;

export type EpgImportStatus =
    (typeof EPG_IMPORT_STATUS)[keyof typeof EPG_IMPORT_STATUS];

export interface EpgImportStats {
    totalChannels: number;
    totalPrograms: number;
}

export interface EpgImportProgress {
    url: string;
    status: EpgImportStatus;
    stats?: EpgImportStats;
    error?: string;
    queuePosition?: number;
}

export interface EpgFetchResult {
    success: boolean;
    message?: string;
    skipped?: string[];
}

export interface EpgFreshnessResult {
    staleUrls: string[];
    freshUrls: string[];
}

export interface EpgClearResult {
    success: boolean;
}

type EpgElectronBridge = Partial<
    {
        checkEpgFreshness: (
            urls: string[],
            maxAgeHours?: number
        ) => Promise<EpgFreshnessResult>;
        clearEpgData: () => Promise<EpgClearResult>;
        fetchEpg: (urls: string[]) => Promise<EpgFetchResult>;
        forceFetchEpg: (url: string) => Promise<EpgFetchResult>;
        getChannelPrograms: (channelId: string) => Promise<EpgProgram[]>;
        getCurrentProgramsBatch: (
            channelIds: string[]
        ) => Promise<Record<string, EpgProgram | null>>;
        getEpgChannelMetadata: (
            channelIds: string[]
        ) => Promise<Record<string, EpgChannelMetadata | null>>;
        getEpgChannelsByRange: (
            skip: number,
            limit: number
        ) => Promise<EpgChannel[]>;
        onEpgProgress: (callback: (data: EpgImportProgress) => void) => void;
        searchEpgPrograms: (
            searchTerm: string,
            limit?: number
        ) => Promise<EpgProgram[]>;
    }
>;

type EpgRuntimeWindow = Window & {
    electron?: EpgElectronBridge;
};

@Injectable({ providedIn: 'root' })
export class EpgRuntimeBridgeService {
    private readonly runtime = inject(RuntimeCapabilitiesService);

    get supportsImport(): boolean {
        return this.runtime.supportsEpgImport;
    }

    get supportsProgress(): boolean {
        return this.runtime.supportsEpgProgress;
    }

    get supportsProgramLookup(): boolean {
        return this.runtime.supportsEpgProgramLookup;
    }

    get supportsCurrentProgramBatch(): boolean {
        return this.runtime.supportsEpgCurrentProgramBatch;
    }

    get supportsChannelMetadata(): boolean {
        return this.runtime.supportsEpgChannelMetadata;
    }

    get supportsSourceFreshness(): boolean {
        return this.runtime.supportsEpgSourceFreshness;
    }

    get supportsDataManagement(): boolean {
        return this.runtime.supportsEpgDataManagement;
    }

    get supportsChannelBrowser(): boolean {
        return this.runtime.supportsEpgChannelBrowser;
    }

    get supportsProgramSearch(): boolean {
        return this.runtime.supportsEpgProgramSearch;
    }

    fetchEpg(urls: string[]): Promise<EpgFetchResult | null> {
        if (!this.supportsImport) {
            return Promise.resolve(null);
        }

        return this.bridge?.fetchEpg?.(urls) ?? Promise.resolve(null);
    }

    forceFetchEpg(url: string): Promise<EpgFetchResult | null> {
        if (!this.supportsDataManagement) {
            return Promise.resolve(null);
        }

        return this.bridge?.forceFetchEpg?.(url) ?? Promise.resolve(null);
    }

    clearEpgData(): Promise<EpgClearResult | null> {
        if (!this.supportsDataManagement) {
            return Promise.resolve(null);
        }

        return this.bridge?.clearEpgData?.() ?? Promise.resolve(null);
    }

    getChannelPrograms(channelId: string): Promise<EpgProgram[] | null> {
        if (!this.supportsProgramLookup) {
            return Promise.resolve(null);
        }

        return this.bridge?.getChannelPrograms?.(channelId) ??
            Promise.resolve(null);
    }

    getCurrentProgramsBatch(
        channelIds: string[]
    ): Promise<Record<string, EpgProgram | null> | null> {
        if (!this.supportsCurrentProgramBatch) {
            return Promise.resolve(null);
        }

        return this.bridge?.getCurrentProgramsBatch?.(channelIds) ??
            Promise.resolve(null);
    }

    getChannelMetadata(
        channelIds: string[]
    ): Promise<Record<string, EpgChannelMetadata | null> | null> {
        if (!this.supportsChannelMetadata) {
            return Promise.resolve(null);
        }

        return this.bridge?.getEpgChannelMetadata?.(channelIds) ??
            Promise.resolve(null);
    }

    checkFreshness(
        urls: string[],
        maxAgeHours?: number
    ): Promise<EpgFreshnessResult | null> {
        if (!this.supportsSourceFreshness) {
            return Promise.resolve(null);
        }

        return this.bridge?.checkEpgFreshness?.(urls, maxAgeHours) ??
            Promise.resolve(null);
    }

    getChannelsByRange(
        skip: number,
        limit: number
    ): Promise<EpgChannel[] | null> {
        if (!this.supportsChannelBrowser) {
            return Promise.resolve(null);
        }

        return this.bridge?.getEpgChannelsByRange?.(skip, limit) ??
            Promise.resolve(null);
    }

    searchPrograms(
        searchTerm: string,
        limit?: number
    ): Promise<EpgProgram[] | null> {
        if (!this.supportsProgramSearch) {
            return Promise.resolve(null);
        }

        return this.bridge?.searchEpgPrograms?.(searchTerm, limit) ??
            Promise.resolve(null);
    }

    onProgress(callback: (data: EpgImportProgress) => void): void {
        if (!this.supportsProgress) {
            return;
        }

        this.bridge?.onEpgProgress?.(callback);
    }

    private get bridge(): EpgElectronBridge | undefined {
        if (typeof window === 'undefined') {
            return undefined;
        }

        return (window as EpgRuntimeWindow).electron;
    }
}
