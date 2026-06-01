import { inject, Injectable } from '@angular/core';
import {
    ElectronBridgeApi,
    ElectronBridgeEpgFetchResult,
    ElectronBridgeEpgProgress,
    ElectronBridgeEpgProgressStats,
    ElectronBridgeEpgProgressStatus,
    ElectronBridgeEpgChannelWithPrograms,
    ElectronBridgeEpgFreshnessResult,
    ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES,
    ElectronBridgeResult,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';

export const EPG_IMPORT_STATUS = ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES;
export type EpgImportStatus = ElectronBridgeEpgProgressStatus;
export type EpgImportStats = ElectronBridgeEpgProgressStats;
export type EpgImportProgress = ElectronBridgeEpgProgress;
export type EpgFetchResult = ElectronBridgeEpgFetchResult;
export type EpgFreshnessResult = ElectronBridgeEpgFreshnessResult;
export type EpgClearResult = ElectronBridgeResult;

type EpgElectronBridge = Pick<
    Partial<ElectronBridgeApi>,
    | 'checkEpgFreshness'
    | 'clearEpgData'
    | 'fetchEpg'
    | 'forceFetchEpg'
    | 'getChannelPrograms'
    | 'getCurrentProgramsBatch'
    | 'getEpgChannelMetadata'
    | 'getEpgChannelsByRange'
    | 'onEpgProgress'
    | 'searchEpgPrograms'
>;

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

        return (
            this.bridge?.getChannelPrograms?.(channelId) ??
            Promise.resolve(null)
        );
    }

    getCurrentProgramsBatch(
        channelIds: string[]
    ): Promise<Record<string, EpgProgram | null> | null> {
        if (!this.supportsCurrentProgramBatch) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.getCurrentProgramsBatch?.(channelIds) ??
            Promise.resolve(null)
        );
    }

    getChannelMetadata(
        channelIds: string[]
    ): Promise<Record<string, EpgChannelMetadata | null> | null> {
        if (!this.supportsChannelMetadata) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.getEpgChannelMetadata?.(channelIds) ??
            Promise.resolve(null)
        );
    }

    checkFreshness(
        urls: string[],
        maxAgeHours?: number
    ): Promise<EpgFreshnessResult | null> {
        if (!this.supportsSourceFreshness) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.checkEpgFreshness?.(urls, maxAgeHours) ??
            Promise.resolve(null)
        );
    }

    getChannelsByRange(
        skip: number,
        limit: number
    ): Promise<ElectronBridgeEpgChannelWithPrograms[] | null> {
        if (!this.supportsChannelBrowser) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.getEpgChannelsByRange?.(skip, limit) ??
            Promise.resolve(null)
        );
    }

    searchPrograms(
        searchTerm: string,
        limit?: number
    ): Promise<EpgProgram[] | null> {
        if (!this.supportsProgramSearch) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.searchEpgPrograms?.(searchTerm, limit) ??
            Promise.resolve(null)
        );
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

        return window.electron;
    }
}
