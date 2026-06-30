import { eq } from 'drizzle-orm';
import { ipcMain } from 'electron';
import {
    ElectronBridgeTrustOptions,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { epgQueryService } from './epg-query.service';
import { epgWorkerService } from './epg-worker.service';
import {
    getEpgMapping,
    getEpgMappingsBatch,
    setEpgMapping,
    deleteEpgMapping,
    searchEpgChannels,
} from '../database/operations/epg-mapping.operations';

/**
 * EPG Events Handler
 * Manages EPG IPC registration and delegates worker/query behavior.
 */
export default class EpgEvents {
    private static readonly loggerLabel = '[EPG Events]';

    /**
     * Bootstrap EPG events
     */
    static bootstrapEpgEvents(): Electron.IpcMain {
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
                    options?: { sourceUrls?: string[] };
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
            'EPG_GET_CHANNELS_BY_RANGE',
            async (_event, args: { skip: number; limit: number }) => {
                return this.handleGetChannelsByRange(args.skip, args.limit);
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

        // EPG channel mapping CRUD
        ipcMain.handle(
            'EPG_MAPPING_GET',
            async (_event, args: { channelKey: string }) => {
                return this.handleGetEpgMapping(args.channelKey);
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
                return this.handleSetEpgMapping(
                    args.channelKey,
                    args.epgChannelId,
                    args.playlistId
                );
            }
        );

        ipcMain.handle(
            'EPG_MAPPING_DELETE',
            async (_event, args: { channelKey: string }) => {
                return this.handleDeleteEpgMapping(args.channelKey);
            }
        );

        ipcMain.handle(
            'EPG_CHANNEL_SEARCH',
            async (
                _event,
                args: { searchTerm: string; limit?: number }
            ) => {
                return this.handleSearchEpgChannels(
                    args.searchTerm,
                    args.limit
                );
            }
        );

        return ipcMain;
    }

    /**
     * Check which EPG URLs have fresh data vs stale/missing data
     * @param urls - EPG source URLs to check
     * @param maxAgeHours - Maximum age in hours before data is considered stale
     */
    private static async checkEpgFreshness(
        urls: string[],
        maxAgeHours: number
    ): Promise<{ staleUrls: string[]; freshUrls: string[] }> {
        const staleUrls: string[] = [];
        const freshUrls: string[] = [];
        const cutoffTime = new Date(
            Date.now() - maxAgeHours * 60 * 60 * 1000
        ).toISOString();

        try {
            const db = await getDatabase();

            for (const url of urls) {
                if (!url?.trim()) continue;

                const result = await db
                    .select({ updatedAt: schema.epgChannels.updatedAt })
                    .from(schema.epgChannels)
                    .where(eq(schema.epgChannels.sourceUrl, url))
                    .limit(1);

                const isFresh =
                    result.length > 0 &&
                    result[0].updatedAt &&
                    result[0].updatedAt >= cutoffTime;

                if (isFresh) {
                    freshUrls.push(url);
                    epgWorkerService.markFetchedUrl(url);
                } else {
                    staleUrls.push(url);
                }
            }
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error checking EPG freshness:',
                error
            );
            return { staleUrls: urls, freshUrls: [] };
        }

        if (freshUrls.length > 0) {
            console.log(
                this.loggerLabel,
                `EPG fresh (skipping): ${freshUrls.length} source(s)`
            );
        }
        if (staleUrls.length > 0) {
            console.log(
                this.loggerLabel,
                `EPG stale (will fetch): ${staleUrls.length} source(s)`
            );
        }

        return { staleUrls, freshUrls };
    }

    /**
     * Handle EPG fetch from URLs
     * Automatically skips URLs with fresh data (less than 12 hours old)
     * Processes URLs sequentially to avoid SQLite database locking issues
     */
    private static async handleFetchEpg(
        urls: string[],
        options: ElectronBridgeTrustOptions = {}
    ): Promise<{ success: boolean; message?: string; skipped?: string[] }> {
        const validUrls = urls.filter((url) => url?.trim());

        if (validUrls.length === 0) {
            return { success: false, message: 'No valid URLs provided' };
        }

        const { staleUrls, freshUrls } = await this.checkEpgFreshness(
            validUrls,
            12
        );

        if (staleUrls.length === 0) {
            return {
                success: true,
                message: 'All EPG data is fresh',
                skipped: freshUrls,
            };
        }

        // Exclude URLs already processed this session — otherwise the loop sends
        // a 'queued' status, then fetchEpgFromUrl silently skips the URL and no
        // completion update ever arrives, leaving the UI stuck at "queued".
        const urlsToFetch = staleUrls.filter(
            (url) => !epgWorkerService.hasFetchedUrl(url)
        );

        if (urlsToFetch.length === 0) {
            console.log(
                this.loggerLabel,
                `All ${staleUrls.length} stale URL(s) already fetched this session; skipping`
            );
            return { success: true, skipped: freshUrls };
        }

        urlsToFetch.forEach((url, index) => {
            epgWorkerService.sendProgressToRenderer(
                url,
                'queued',
                undefined,
                undefined,
                index + 1
            );
        });

        const errors: string[] = [];
        for (const url of urlsToFetch) {
            try {
                await this.fetchEpgFromUrl(url, options);
            } catch (error) {
                console.error(
                    this.loggerLabel,
                    `Error fetching EPG from ${url}:`,
                    error
                );
                errors.push(
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        if (errors.length > 0) {
            return {
                success: errors.length < urlsToFetch.length,
                message: errors.join('; '),
                skipped: freshUrls,
            };
        }

        return { success: true, skipped: freshUrls };
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
        const resolvedId = await this.resolveChannelId(channelId);
        return epgQueryService.getChannelPrograms(resolvedId, options);
    }

    private static async handleGetCurrentProgramsBatch(
        channelIds: string[],
        options?: { sourceUrls?: string[] }
    ): Promise<Record<string, EpgProgram | null>> {
        const resolvedMap = await this.resolveChannelIds(channelIds);
        const resolvedIds = channelIds.map(
            (id) => resolvedMap.get(id) ?? id
        );
        const results = await epgQueryService.getCurrentProgramsBatch(
            resolvedIds,
            options
        );
        // Remap results back to the original request keys.
        const remapped: Record<string, EpgProgram | null> = {};
        for (const originalId of channelIds) {
            const resolvedId = resolvedMap.get(originalId) ?? originalId;
            remapped[originalId] = results[resolvedId] ?? null;
        }
        return remapped;
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
        const resolvedMap = await this.resolveChannelIds(channelIds);
        const resolvedIds = channelIds.map(
            (id) => resolvedMap.get(id) ?? id
        );
        const results = await epgQueryService.getChannelMetadata(
            resolvedIds,
            options
        );
        // Remap results back to the original request keys.
        const remapped: Record<string, EpgChannelMetadata | null> = {};
        for (const originalId of channelIds) {
            const resolvedId = resolvedMap.get(originalId) ?? originalId;
            remapped[originalId] = results[resolvedId] ?? null;
        }
        return remapped;
    }

    private static async handleGetChannelsByRange(
        skip: number,
        limit: number
    ): Promise<
        Array<{
            id: string;
            displayName: string;
            iconUrl: string | null;
            programs: EpgProgram[];
        }>
    > {
        return epgQueryService.getChannelsByRange(skip, limit);
    }

    // ---------------------------------------------------------------------------
    // EPG mapping resolution — called at the IPC boundary before queries.
    // ---------------------------------------------------------------------------

    /**
     * Resolve a single channel ID through manual mappings.
     * Returns the mapped EPG channel ID when a mapping exists, or the original.
     */
    private static async resolveChannelId(
        channelId: string
    ): Promise<string> {
        try {
            const db = await getDatabase();
            const mapping = await getEpgMapping(db, channelId);
            return mapping?.epgChannelId ?? channelId;
        } catch {
            return channelId;
        }
    }

    /**
     * Batch-resolve multiple channel IDs through manual mappings.
     * Returns a Map of original ID → mapped ID (identity when no mapping).
     */
    private static async resolveChannelIds(
        channelIds: string[]
    ): Promise<Map<string, string>> {
        try {
            const db = await getDatabase();
            const mappings = await getEpgMappingsBatch(db, channelIds);
            return mappings;
        } catch {
            return new Map();
        }
    }

    // ---------------------------------------------------------------------------
    // EPG mapping CRUD handlers
    // ---------------------------------------------------------------------------

    private static async handleGetEpgMapping(
        channelKey: string
    ): Promise<{ id: number; channelKey: string; epgChannelId: string; playlistId: string | null } | null> {
        try {
            const db = await getDatabase();
            return getEpgMapping(db, channelKey);
        } catch {
            return null;
        }
    }

    private static async handleSetEpgMapping(
        channelKey: string,
        epgChannelId: string,
        playlistId?: string
    ): Promise<{ success: boolean }> {
        try {
            const db = await getDatabase();
            return setEpgMapping(db, channelKey, epgChannelId, playlistId);
        } catch {
            return { success: false };
        }
    }

    private static async handleDeleteEpgMapping(
        channelKey: string
    ): Promise<{ success: boolean }> {
        try {
            const db = await getDatabase();
            return deleteEpgMapping(db, channelKey);
        } catch {
            return { success: false };
        }
    }

    private static async handleSearchEpgChannels(
        searchTerm: string,
        limit?: number
    ): Promise<Array<{ id: string; displayName: string; iconUrl: string | null }>> {
        if (!searchTerm?.trim()) {
            return [];
        }

        try {
            const db = await getDatabase();
            return searchEpgChannels(db, searchTerm, limit);
        } catch {
            return [];
        }
    }

    static async clearEpgData(): Promise<void> {
        return epgWorkerService.clearEpgData();
    }

    static async clearEpgDataForSource(sourceUrl: string): Promise<void> {
        return epgWorkerService.clearEpgDataForSource(sourceUrl);
    }
}
