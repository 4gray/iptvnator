import { reconcileEpgSources } from './epg-source-settings.service';
import { ipcMain } from 'electron';
import {
    ElectronBridgeCurrentProgramsOptions,
    ElectronBridgeEpgGuideWindow,
    ElectronBridgeTrustOptions,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { epgQueryService } from './epg-query.service';
import { epgGuideQueryService } from './epg-guide-query.service';
import { epgWorkerService } from './epg-worker.service';
import { checkEpgFreshness, handleFetchEpg } from './epg-fetch.service';
import type { EpgFetchResult, EpgFreshnessResult } from './epg-fetch.service';
import {
    handleDeleteEpgMapping,
    handleGetEpgMapping,
    handleGetEpgMappingsBatch,
    handleSearchEpgChannels,
    handleSetEpgMapping,
    queryByResolvedChannelIds,
    resolveChannelIds,
} from './epg-mapping.service';

/**
 * EPG Events Handler
 * Manages EPG IPC registration and delegates worker/query behavior.
 * Freshness and fetch orchestration live in `epg-fetch.service.ts`; manual
 * channel-mapping resolution and CRUD live in `epg-mapping.service.ts`.
 */
export default class EpgEvents {
    /**
     * Bootstrap EPG events
     */
    static bootstrapEpgEvents(): Electron.IpcMain {
        ipcMain.handle(
            'EPG_RECONCILE_SOURCES',
            async (_event, args: { urls: string[] }) => {
                await reconcileEpgSources(args.urls);
                return { success: true };
            }
        );

        ipcMain.handle(
            'FETCH_EPG',
            async (
                _event,
                args: { url: string[]; options?: ElectronBridgeTrustOptions }
            ) => {
                return await this.handleFetchEpg(args.url, args.options);
            }
        );

        ipcMain.handle(
            'GET_CHANNEL_PROGRAMS',
            async (
                _event,
                args: { channelId: string; options?: { sourceUrls?: string[] } }
            ) => {
                return this.handleGetChannelPrograms(
                    args.channelId,
                    args.options
                );
            }
        );

        ipcMain.handle(
            'GET_CURRENT_PROGRAMS_BATCH',
            async (
                _event,
                args: {
                    channelIds: string[];
                    options?: ElectronBridgeCurrentProgramsOptions;
                }
            ) => {
                return this.handleGetCurrentProgramsBatch(
                    args.channelIds,
                    args.options
                );
            }
        );

        ipcMain.handle('EPG_GET_CHANNELS', async () => {
            return this.handleGetAllChannels();
        });

        ipcMain.handle(
            'EPG_GET_CHANNEL_METADATA',
            async (
                _event,
                args: {
                    channelIds: string[];
                    options?: { sourceUrls?: string[] };
                }
            ) => {
                return this.handleGetChannelMetadata(
                    args.channelIds,
                    args.options
                );
            }
        );

        ipcMain.handle(
            'EPG_GET_PROGRAMS_FOR_CHANNELS',
            async (_event, args: ElectronBridgeEpgGuideWindow) => {
                return this.handleGetGuidePrograms(args);
            }
        );

        ipcMain.handle(
            'EPG_GET_PROGRAM_COVERAGE',
            async (_event, args: ElectronBridgeEpgGuideWindow) => {
                return this.handleGetGuideCoverage(args);
            }
        );

        ipcMain.handle(
            'EPG_FORCE_FETCH',
            async (
                _event,
                args:
                    | string
                    | { url: string; options?: ElectronBridgeTrustOptions }
            ) => {
                const url = typeof args === 'string' ? args : args.url;
                const options =
                    typeof args === 'string' ? undefined : args.options;
                epgWorkerService.deleteFetchedUrl(url);
                return await this.handleFetchEpg([url], options);
            }
        );

        ipcMain.handle('EPG_CLEAR_ALL', async () => {
            await this.clearEpgData();
            return { success: true };
        });

        ipcMain.handle(
            'EPG_CLEAR_SOURCE',
            async (_event, args: { sourceUrl: string }) => {
                await this.clearEpgDataForSource(args.sourceUrl);
                return { success: true };
            }
        );

        ipcMain.handle(
            'EPG_CHECK_FRESHNESS',
            async (
                _event,
                args: { urls: string[]; maxAgeHours?: number }
            ): Promise<{ staleUrls: string[]; freshUrls: string[] }> => {
                return this.checkEpgFreshness(
                    args.urls,
                    args.maxAgeHours ?? 12
                );
            }
        );

        // EPG channel mapping CRUD — handled entirely by epg-mapping.service.
        ipcMain.handle(
            'EPG_MAPPING_GET',
            async (_event, args: { channelKey: string }) => {
                return handleGetEpgMapping(args.channelKey);
            }
        );

        ipcMain.handle(
            'EPG_MAPPING_SET',
            async (
                _event,
                args: {
                    channelKey: string;
                    epgChannelId: string;
                    playlistId?: string;
                }
            ) => {
                return handleSetEpgMapping(
                    args.channelKey,
                    args.epgChannelId,
                    args.playlistId
                );
            }
        );

        ipcMain.handle(
            'EPG_MAPPING_GET_BATCH',
            async (_event, args: { channelKeys: string[] }) => {
                return handleGetEpgMappingsBatch(args.channelKeys);
            }
        );

        ipcMain.handle(
            'EPG_MAPPING_DELETE',
            async (_event, args: { channelKey: string }) => {
                return handleDeleteEpgMapping(args.channelKey);
            }
        );

        ipcMain.handle(
            'EPG_CHANNEL_SEARCH',
            async (_event, args: { searchTerm: string; limit?: number }) => {
                return handleSearchEpgChannels(args.searchTerm, args.limit);
            }
        );

        return ipcMain;
    }

    private static async checkEpgFreshness(
        urls: string[],
        maxAgeHours: number
    ): Promise<EpgFreshnessResult> {
        return checkEpgFreshness(urls, maxAgeHours);
    }

    private static async handleFetchEpg(
        urls: string[],
        options: ElectronBridgeTrustOptions = {}
    ): Promise<EpgFetchResult> {
        return handleFetchEpg(urls, options);
    }

    private static async fetchEpgFromUrl(
        url: string,
        options: ElectronBridgeTrustOptions = {}
    ): Promise<void> {
        return epgWorkerService.fetchEpgFromUrl(url, options);
    }

    private static async handleGetChannelPrograms(
        channelId: string,
        options?: { sourceUrls?: string[] }
    ): Promise<EpgProgram[]> {
        return epgQueryService.getChannelPrograms(channelId, options);
    }

    private static async handleGetCurrentProgramsBatch(
        channelIds: string[],
        options?: ElectronBridgeCurrentProgramsOptions
    ): Promise<Record<string, EpgProgram | null>> {
        return queryByResolvedChannelIds(channelIds, (resolvedIds) =>
            epgQueryService.getCurrentProgramsBatch(resolvedIds, options)
        );
    }

    private static async handleGetAllChannels(): Promise<{
        channels: Array<{ id: string; displayName: string }>;
        programs: never[];
    }> {
        return epgQueryService.getAllChannels();
    }

    private static async handleGetChannelMetadata(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        return queryByResolvedChannelIds(channelIds, (resolvedIds) =>
            epgQueryService.getChannelMetadata(resolvedIds, options)
        );
    }

    /**
     * The guide query service keys its answer by the TRIMMED, deduplicated,
     * cap-respecting form of the channel ids it was given
     * (`normalizeGuideWindow`). Handlers must resolve the same trimmed key
     * to look up that answer, or a padded request id (`" CNN "`) would never
     * find its entry even though the service queried it successfully.
     */
    private static resolvedGuideKey(
        mapping: Map<string, string>,
        id: unknown
    ): string {
        return typeof id === 'string' ? (mapping.get(id) ?? id).trim() : '';
    }

    /**
     * Guide reads take playlist channel keys. Manual mappings are applied
     * here, before the query, and the answer is keyed back by the requested
     * key so the renderer never sees a mapped id. A key the service did not
     * answer for (cut by its per-request cap) stays absent from the result
     * rather than being filled with `[]`, so callers can tell "queried,
     * nothing found" apart from "not queried at all".
     */
    private static async handleGetGuidePrograms(
        args: ElectronBridgeEpgGuideWindow
    ): Promise<Record<string, EpgProgram[]>> {
        const requested = Array.isArray(args?.channelIds)
            ? args.channelIds
            : [];
        const mapping = await resolveChannelIds(requested);
        const resolvedIds = requested.map((id) => mapping.get(id) ?? id);
        const programs = await epgGuideQueryService.getProgramsForChannels({
            ...args,
            channelIds: resolvedIds,
        });
        const answer: Record<string, EpgProgram[]> = Object.create(null);
        for (const id of requested) {
            const key = this.resolvedGuideKey(mapping, id);
            if (Object.prototype.hasOwnProperty.call(programs, key)) {
                // Copy so two requested ids resolving to one target never
                // share an array reference.
                answer[String(id)] = [...programs[key]];
            }
        }
        return answer;
    }

    /** A thrown error rejects the renderer's `invoke`, which is the intended fail-open path for coverage. */
    private static async handleGetGuideCoverage(
        args: ElectronBridgeEpgGuideWindow
    ): Promise<string[]> {
        const requested = Array.isArray(args?.channelIds)
            ? args.channelIds
            : [];
        const mapping = await resolveChannelIds(requested);
        const resolvedIds = requested.map((id) => mapping.get(id) ?? id);
        const covered = new Set(
            await epgGuideQueryService.getProgramCoverage({
                ...args,
                channelIds: resolvedIds,
            })
        );
        const seen = new Set<string>();
        const answer: string[] = [];
        for (const id of requested) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            if (covered.has(this.resolvedGuideKey(mapping, id))) {
                answer.push(id);
            }
        }
        return answer;
    }

    static async clearEpgData(): Promise<void> {
        return epgWorkerService.clearEpgData();
    }

    static async clearEpgDataForSource(sourceUrl: string): Promise<void> {
        return epgWorkerService.clearEpgDataForSource(sourceUrl);
    }
}
