import { inject, Injectable } from '@angular/core';
import {
    ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES,
    ElectronBridgeApi,
    ElectronBridgeCurrentProgramsOptions,
    ElectronBridgeEpgFetchResult,
    ElectronBridgeEpgMapping,
    ElectronBridgeEpgProgress,
    ElectronBridgeEpgProgressStats,
    ElectronBridgeEpgProgressStatus,
    ElectronBridgeEpgSearchProgram,
    ElectronBridgeEpgSearchResult,
    ElectronBridgeEpgGuideWindow,
    ElectronBridgeEpgFreshnessResult,
    ElectronBridgeEpgLookupOptions,
    ElectronBridgeResult,
    ElectronBridgeTrustOptions,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import {
    EpgPreferencesService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';

export const EPG_IMPORT_STATUS = ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES;
export type EpgImportStatus = ElectronBridgeEpgProgressStatus;
export type EpgImportStats = ElectronBridgeEpgProgressStats;
export type EpgImportProgress = ElectronBridgeEpgProgress;
export type EpgFetchResult = ElectronBridgeEpgFetchResult;
export type EpgFreshnessResult = ElectronBridgeEpgFreshnessResult;
export type EpgClearResult = ElectronBridgeResult;
export interface EpgLookupOptions extends ElectronBridgeEpgLookupOptions {
    /**
     * Retry the keys the scoped lookup (playlist scope, then Settings-managed
     * global sources) left without a programme against every imported XMLTV
     * source. Off by default: the scopes exist so a playlist's own guide wins
     * over a same-named channel in another playlist's guide. Surfaces with no
     * playlist context — the dashboard live rails — opt in, matching the
     * collection resolver and the timeline, which never scope by source.
     * Renderer-only: it is not forwarded to the desktop bridge.
     */
    anySourceFallback?: boolean;
}
export type EpgCurrentProgramsOptions = ElectronBridgeCurrentProgramsOptions;

type EpgElectronBridge = Pick<
    Partial<ElectronBridgeApi>,
    | 'checkEpgFreshness'
    | 'clearEpgData'
    | 'clearEpgDataForSource'
    | 'fetchEpg'
    | 'forceFetchEpg'
    | 'openEpgFileDialog'
    | 'getChannelPrograms'
    | 'getCurrentProgramsBatch'
    | 'getEpgChannelMetadata'
    | 'getEpgProgramsForChannels'
    | 'getEpgProgramCoverage'
    | 'onEpgProgress'
    | 'searchEpgPrograms'
    | 'getEpgMapping'
    | 'getEpgMappingsBatch'
    | 'setEpgMapping'
    | 'deleteEpgMapping'
    | 'searchEpgChannels'
>;

@Injectable({ providedIn: 'root' })
export class EpgRuntimeBridgeService {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly preferences = inject(EpgPreferencesService);

    get supportsImport(): boolean {
        return this.runtime.supportsEpgImport;
    }

    get supportsProgress(): boolean {
        return this.runtime.supportsEpgProgress;
    }

    get supportsFilePicker(): boolean {
        return this.runtime.supportsEpgFilePicker;
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

    get supportsGuide(): boolean {
        return this.runtime.supportsEpgGuide;
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

        return this.preferences.run(
            () =>
                this.bridge?.fetchEpg?.(urls, options) ?? Promise.resolve(null),
            null
        );
    }

    forceFetchEpg(
        url: string,
        options?: ElectronBridgeTrustOptions
    ): Promise<EpgFetchResult | null> {
        if (!this.supportsDataManagement) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                this.bridge?.forceFetchEpg?.(url, options) ??
                Promise.resolve(null),
            null
        );
    }

    /** Native picker for a local XMLTV file; null when unsupported or cancelled. */
    pickEpgFile(): Promise<string | null> {
        if (!this.supportsFilePicker) {
            return Promise.resolve(null);
        }

        return this.bridge?.openEpgFileDialog?.() ?? Promise.resolve(null);
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

        const bridge = this.bridge;
        const lookup = bridge?.getChannelPrograms;
        if (!lookup) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                options
                    ? lookup.call(bridge, channelId, options)
                    : lookup.call(bridge, channelId),
            null
        );
    }

    getCurrentProgramsBatch(
        channelIds: string[],
        options?: EpgCurrentProgramsOptions
    ): Promise<Record<string, EpgProgram | null> | null> {
        if (!this.supportsCurrentProgramBatch) {
            return Promise.resolve(null);
        }

        const bridge = this.bridge;
        const lookup = bridge?.getCurrentProgramsBatch;
        if (!lookup) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                options
                    ? lookup.call(bridge, channelIds, options)
                    : lookup.call(bridge, channelIds),
            null
        );
    }

    getChannelMetadata(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Promise<Record<string, EpgChannelMetadata | null> | null> {
        if (!this.supportsChannelMetadata) {
            return Promise.resolve(null);
        }

        const bridge = this.bridge;
        const lookup = bridge?.getEpgChannelMetadata;
        if (!lookup) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                options
                    ? lookup.call(bridge, channelIds, options)
                    : lookup.call(bridge, channelIds),
            null
        );
    }

    checkFreshness(
        urls: string[],
        maxAgeHours?: number
    ): Promise<EpgFreshnessResult | null> {
        if (!this.supportsSourceFreshness) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                this.bridge?.checkEpgFreshness?.(urls, maxAgeHours) ??
                Promise.resolve(null),
            null
        );
    }

    getProgramsForChannels(
        guideWindow: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]> | null> {
        if (!this.supportsGuide || guideWindow.channelIds.length === 0) {
            return Promise.resolve(null);
        }
        return this.preferences.run(
            () =>
                this.bridge?.getEpgProgramsForChannels?.(guideWindow) ??
                Promise.resolve(null),
            null
        );
    }

    getProgramCoverage(
        guideWindow: ElectronBridgeEpgGuideWindow
    ): Promise<string[] | null> {
        if (!this.supportsGuide || guideWindow.channelIds.length === 0) {
            return Promise.resolve(null);
        }
        return this.preferences.run(
            () =>
                this.bridge?.getEpgProgramCoverage?.(guideWindow) ??
                Promise.resolve(null),
            null
        );
    }

    searchPrograms(
        searchTerm: string,
        limit?: number
    ): Promise<ElectronBridgeEpgSearchProgram[] | null> {
        if (!this.supportsProgramSearch) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                this.bridge?.searchEpgPrograms?.(searchTerm, limit) ??
                Promise.resolve(null),
            null
        );
    }

    getEpgMapping(
        channelKey: string
    ): Promise<ElectronBridgeEpgMapping | null> {
        if (!this.supportsEpgMapping) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                this.bridge?.getEpgMapping?.(channelKey) ??
                Promise.resolve(null),
            null
        );
    }

    getEpgMappingsBatch(
        channelKeys: string[]
    ): Promise<Record<string, string> | null> {
        if (!this.supportsEpgMapping || channelKeys.length === 0) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                this.bridge?.getEpgMappingsBatch?.(channelKeys) ??
                Promise.resolve(null),
            null
        );
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
            this.bridge?.setEpgMapping?.(
                channelKey,
                epgChannelId,
                playlistId
            ) ?? Promise.resolve(null)
        );
    }

    deleteEpgMapping(channelKey: string): Promise<ElectronBridgeResult | null> {
        if (!this.supportsEpgMapping) {
            return Promise.resolve(null);
        }

        return (
            this.bridge?.deleteEpgMapping?.(channelKey) ?? Promise.resolve(null)
        );
    }

    searchEpgChannels(
        searchTerm: string,
        limit?: number
    ): Promise<ElectronBridgeEpgSearchResult[] | null> {
        if (!this.supportsEpgMapping) {
            return Promise.resolve(null);
        }

        return this.preferences.run(
            () =>
                this.bridge?.searchEpgChannels?.(searchTerm, limit) ??
                Promise.resolve(null),
            null
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
