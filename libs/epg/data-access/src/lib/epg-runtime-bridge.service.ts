import { inject, Injectable } from '@angular/core';
import {
    ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES,
    ElectronBridgeApi,
    ElectronBridgeEpgFetchResult,
    ElectronBridgeEpgMapping,
    ElectronBridgeEpgProgress,
    ElectronBridgeEpgProgressStats,
    ElectronBridgeEpgProgressStatus,
    ElectronBridgeEpgSearchResult,
    ElectronBridgeEpgChannelWithPrograms,
    ElectronBridgeEpgFreshnessResult,
    ElectronBridgeEpgLookupOptions,
    ElectronBridgeResult,
    ElectronBridgeTrustOptions,
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
export type EpgLookupOptions = ElectronBridgeEpgLookupOptions;

type EpgElectronBridge = Pick<
    Partial<ElectronBridgeApi>,
    | 'checkEpgFreshness'
    | 'clearEpgData'
    | 'clearEpgDataForSource'
    | 'fetchEpg'
    | 'forceFetchEpg'
    | 'getChannelPrograms'
    | 'getCurrentProgramsBatch'
    | 'getEpgChannelMetadata'
    | 'getEpgChannelsByRange'
    | 'onEpgProgress'
    | 'searchEpgPrograms'
    | 'getEpgMapping'
    | 'setEpgMapping'
    | 'deleteEpgMapping'
    | 'searchEpgChannels'
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

    get supportsEpgMapping(): boolean {
        return this.runtime.supportsEpgMapping;
    }

    fetchEpg(
        urls: string[],
        options?: ElectronBridgeTrustOptions
    ): Promise<EpgFetchResult | null> {
        if (!this.supportsImport) {
            return Promise.resolve(null);
        }

        return this.bridge?.fetchEpg?.(urls, options) ?? Promise.resolve(null);
    }

    forceFetchEpg(
        url: string,
        options?: ElectronBridgeTrustOptions
    ): Promise<EpgFetchResult | null> {
        if (!this.supportsDataManagement) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.forceFetchEpg?.(url, options) ?? Promise.resolve(null)
        );
    }

    clearEpgData(): Promise<EpgClearResult | null> {
        if (!this.supportsDataManagement) {
            return Promise.resolve(null);
        }

        return this.bridge?.clearEpgData?.() ?? Promise.resolve(null);
    }

    clearEpgDataForSource(sourceUrl: string): Promise<EpgClearResult | null> {
        if (!this.supportsDataManagement) {
            return Promise.resolve(null);
        }

        const normalizedSourceUrl = sourceUrl.trim();
        if (!normalizedSourceUrl) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.clearEpgDataForSource?.(normalizedSourceUrl) ??
            Promise.resolve(null)
        );
    }

    getChannelPrograms(
        channelId: string,
        options?: EpgLookupOptions
    ): Promise<EpgProgram[] | null> {
        if (!this.supportsProgramLookup) {
            return Promise.resolve(null);
        }

        if (!this.bridge?.getChannelPrograms) {
            return Promise.resolve(null);
        }

        return options
            ? this.bridge.getChannelPrograms(channelId, options)
            : this.bridge.getChannelPrograms(channelId);
    }

    getCurrentProgramsBatch(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Promise<Record<string, EpgProgram | null> | null> {
        if (!this.supportsCurrentProgramBatch) {
            return Promise.resolve(null);
        }

        if (!this.bridge?.getCurrentProgramsBatch) {
            return Promise.resolve(null);
        }

        return options
            ? this.bridge.getCurrentProgramsBatch(channelIds, options)
            : this.bridge.getCurrentProgramsBatch(channelIds);
    }

    getChannelMetadata(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Promise<Record<string, EpgChannelMetadata | null> | null> {
        if (!this.supportsChannelMetadata) {
            return Promise.resolve(null);
        }

        if (!this.bridge?.getEpgChannelMetadata) {
            return Promise.resolve(null);
        }

        return options
            ? this.bridge.getEpgChannelMetadata(channelIds, options)
            : this.bridge.getEpgChannelMetadata(channelIds);
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

    getEpgMapping(
        channelKey: string
    ): Promise<ElectronBridgeEpgMapping | null> {
        if (!this.supportsEpgMapping) {
            return Promise.resolve(null);
        }

        return this.bridge?.getEpgMapping?.(channelKey) ?? Promise.resolve(null);
    }

    setEpgMapping(
        channelKey: string,
        epgChannelId: string,
        playlistId?: string
    ): Promise<ElectronBridgeResult | null> {
        if (!this.supportsEpgMapping) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.setEpgMapping?.(channelKey, epgChannelId, playlistId) ??
            Promise.resolve(null)
        );
    }

    deleteEpgMapping(channelKey: string): Promise<ElectronBridgeResult | null> {
        if (!this.supportsEpgMapping) {
            return Promise.resolve(null);
        }

        return this.bridge?.deleteEpgMapping?.(channelKey) ?? Promise.resolve(null);
    }

    searchEpgChannels(
        searchTerm: string,
        limit?: number
    ): Promise<ElectronBridgeEpgSearchResult[] | null> {
        if (!this.supportsEpgMapping) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.searchEpgChannels?.(searchTerm, limit) ??
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
