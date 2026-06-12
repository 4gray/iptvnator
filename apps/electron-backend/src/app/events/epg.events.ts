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
            async (_event, args: { channelId: string }) => {
                return this.handleGetChannelPrograms(args.channelId);
            }
        );

        ipcMain.handle(
            'GET_CURRENT_PROGRAMS_BATCH',
            async (_event, args: { channelIds: string[] }) => {
                return this.handleGetCurrentProgramsBatch(args.channelIds);
            }
        );

        ipcMain.handle('EPG_GET_CHANNELS', async () => {
            return this.handleGetAllChannels();
        });

        ipcMain.handle(
            'EPG_GET_CHANNEL_METADATA',
            async (_event, args: { channelIds: string[] }) => {
                return this.handleGetChannelMetadata(args.channelIds);
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
        channelId: string
    ): Promise<EpgProgram[]> {
        return epgQueryService.getChannelPrograms(channelId);
    }

    private static async handleGetCurrentProgramsBatch(
        channelIds: string[]
    ): Promise<Record<string, EpgProgram | null>> {
        return epgQueryService.getCurrentProgramsBatch(channelIds);
    }

    private static async handleGetAllChannels(): Promise<{
        channels: Array<{ id: string; displayName: string }>;
        programs: never[];
    }> {
        return epgQueryService.getAllChannels();
    }

    private static async handleGetChannelMetadata(
        channelIds: string[]
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        return epgQueryService.getChannelMetadata(channelIds);
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

    static async clearEpgData(): Promise<void> {
        return epgWorkerService.clearEpgData();
    }
}
