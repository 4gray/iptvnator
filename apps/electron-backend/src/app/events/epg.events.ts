import { eq, sql } from 'drizzle-orm';
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { EpgProgram } from 'shared-interfaces';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';

/**
 * EPG Events Handler
 * Manages EPG data fetching and querying using worker threads.
 * Database operations are performed in the worker thread to avoid blocking the main thread.
 */
export default class EpgEvents {
    private static fetchedUrls: Set<string> = new Set();
    private static workers: Map<string, Worker> = new Map();
    private static readonly loggerLabel = '[EPG Events]';

    /**
     * Send EPG progress to all renderer windows
     */
    private static sendProgressToRenderer(
        url: string,
        status: 'queued' | 'loading' | 'complete' | 'error',
        stats?: { totalChannels: number; totalPrograms: number },
        error?: string,
        queuePosition?: number
    ): void {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
            win.webContents.send('EPG_PROGRESS_UPDATE', {
                url,
                status,
                stats,
                error,
                queuePosition,
            });
        });
    }

    /**
     * Bootstrap EPG events
     */
    static bootstrapEpgEvents(): Electron.IpcMain {
        // Fetch EPG from URLs
        ipcMain.handle('FETCH_EPG', async (_event, args: { url: string[] }) => {
            return await this.handleFetchEpg(args.url);
        });

        // Get programs for a specific channel
        ipcMain.handle(
            'GET_CHANNEL_PROGRAMS',
            async (_event, args: { channelId: string }) => {
                return this.handleGetChannelPrograms(args.channelId);
            }
        );

        // Get all channels from database
        ipcMain.handle('EPG_GET_CHANNELS', async () => {
            return this.handleGetAllChannels();
        });

        // Get channels by range (pagination)
        ipcMain.handle(
            'EPG_GET_CHANNELS_BY_RANGE',
            async (_event, args: { skip: number; limit: number }) => {
                return this.handleGetChannelsByRange(args.skip, args.limit);
            }
        );

        // Force fetch (ignore cache)
        ipcMain.handle('EPG_FORCE_FETCH', async (_event, url: string) => {
            this.fetchedUrls.delete(url);
            return await this.handleFetchEpg([url]);
        });

        // Clear all EPG data
        ipcMain.handle('EPG_CLEAR_ALL', async () => {
            await this.clearEpgData();
            return { success: true };
        });

        // Check if EPG data for URLs is fresh (not stale)
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
                    this.fetchedUrls.add(url);
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

        // Log summary
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
        urls: string[]
    ): Promise<{ success: boolean; message?: string; skipped?: string[] }> {
        const validUrls = urls.filter((url) => url?.trim());

        if (validUrls.length === 0) {
            return { success: false, message: 'No valid URLs provided' };
        }

        // Check which URLs have fresh data and can be skipped
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

        // Send queued status for all stale URLs first
        staleUrls.forEach((url, index) => {
            this.sendProgressToRenderer(
                url,
                'queued',
                undefined,
                undefined,
                index + 1
            );
        });

        // Process only stale URLs sequentially to avoid database locking
        const errors: string[] = [];
        for (let i = 0; i < staleUrls.length; i++) {
            const url = staleUrls[i];
            try {
                await this.fetchEpgFromUrl(url);
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
                success: errors.length < staleUrls.length, // Partial success if some worked
                message: errors.join('; '),
                skipped: freshUrls,
            };
        }

        return { success: true, skipped: freshUrls };
    }

    /**
     * Fetch EPG from a single URL using worker thread
     * The worker handles both parsing AND database operations
     */
    private static async fetchEpgFromUrl(url: string): Promise<void> {
        // Skip if already fetched this session
        if (this.fetchedUrls.has(url)) {
            console.log(
                this.loggerLabel,
                `Skipping already fetched URL: ${url}`
            );
            return;
        }

        return new Promise((resolve, reject) => {
            let workerPath: string;

            if (app.isPackaged) {
                const resourcesPath = path.dirname(app.getAppPath());
                workerPath = path.join(
                    resourcesPath,
                    'dist',
                    'apps',
                    'electron-backend',
                    'workers',
                    'epg-parser.worker.js'
                );
            } else {
                workerPath = path.join(
                    __dirname,
                    'workers',
                    'epg-parser.worker.js'
                );
            }

            let worker: Worker;
            try {
                const workerURL = pathToFileURL(workerPath);
                // In packaged app, native modules are in app.asar.unpacked/node_modules
                // which is separate from the worker location in extraResources
                const nativeModulesPath = app.isPackaged
                    ? path.join(
                          path.dirname(app.getAppPath()),
                          'app.asar.unpacked',
                          'node_modules'
                      )
                    : undefined;
                worker = new Worker(workerURL, {
                    resourceLimits: {
                        maxOldGenerationSizeMb: 4096,
                        maxYoungGenerationSizeMb: 512,
                    },
                    workerData: { nativeModulesPath },
                });
            } catch (error) {
                console.error(
                    this.loggerLabel,
                    'Failed to create worker:',
                    error
                );
                reject(error);
                return;
            }

            this.workers.set(url, worker);

            worker.on(
                'message',
                async (message: {
                    type: string;
                    error?: string;
                    url?: string;
                    stats?: { totalChannels: number; totalPrograms: number };
                }) => {
                    try {
                        switch (message.type) {
                            case 'READY':
                                // Notify renderer that loading started
                                this.sendProgressToRenderer(url, 'loading', {
                                    totalChannels: 0,
                                    totalPrograms: 0,
                                });
                                worker.postMessage({ type: 'FETCH_EPG', url });
                                break;

                            case 'EPG_PROGRESS':
                                if (message.stats) {
                                    console.log(
                                        this.loggerLabel,
                                        `Progress: ${message.stats.totalChannels} channels, ${message.stats.totalPrograms} programs`
                                    );
                                    // Forward progress to renderer
                                    this.sendProgressToRenderer(
                                        url,
                                        'loading',
                                        message.stats
                                    );
                                }
                                break;

                            case 'EPG_COMPLETE':
                                console.log(
                                    this.loggerLabel,
                                    `EPG parsing complete for ${url}:`,
                                    message.stats
                                );
                                // Notify renderer of completion
                                this.sendProgressToRenderer(
                                    url,
                                    'complete',
                                    message.stats
                                );
                                this.fetchedUrls.add(url);
                                worker.terminate();
                                this.workers.delete(url);
                                resolve();
                                break;

                            case 'EPG_ERROR':
                                console.error(
                                    this.loggerLabel,
                                    'Worker error:',
                                    message.error
                                );
                                // Notify renderer of error
                                this.sendProgressToRenderer(
                                    url,
                                    'error',
                                    undefined,
                                    message.error
                                );
                                worker.terminate();
                                this.workers.delete(url);
                                reject(
                                    new Error(message.error || 'Unknown error')
                                );
                                break;
                        }
                    } catch (err) {
                        console.error(
                            this.loggerLabel,
                            'Error handling message:',
                            err
                        );
                        reject(err);
                    }
                }
            );

            worker.on('error', (error) => {
                console.error(this.loggerLabel, 'Worker error event:', error);
                worker.terminate();
                this.workers.delete(url);
                reject(error);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(
                        this.loggerLabel,
                        `Worker stopped with exit code ${code}`
                    );
                }
            });
        });
    }

    /**
     * Transform database row to flat EpgProgram interface
     */
    private static transformDbRowToEpgProgram(row: {
        id: number;
        channelId: string;
        start: string;
        stop: string;
        title: string;
        description: string | null;
        category: string | null;
        iconUrl: string | null;
        rating: string | null;
        episodeNum: string | null;
    }) {
        return {
            start: row.start,
            stop: row.stop,
            channel: row.channelId,
            title: row.title,
            desc: row.description,
            category: row.category,
            iconUrl: row.iconUrl,
            rating: row.rating,
            episodeNum: row.episodeNum,
        };
    }

    /**
     * Get programs for a specific channel from database
     */
    private static async handleGetChannelPrograms(
        channelId: string
    ): Promise<EpgProgram[]> {
        try {
            const db = await getDatabase();

            // Try exact channel ID match first
            let results = await db
                .select()
                .from(schema.epgPrograms)
                .where(eq(schema.epgPrograms.channelId, channelId))
                .orderBy(schema.epgPrograms.start)
                .limit(500);

            if (results.length > 0) {
                return results.map(this.transformDbRowToEpgProgram);
            }

            // Try to find channel by display name
            const channel = await db
                .select()
                .from(schema.epgChannels)
                .where(
                    sql`LOWER(${schema.epgChannels.displayName}) LIKE LOWER(${'%' + channelId + '%'})`
                )
                .limit(1);

            if (channel.length > 0) {
                results = await db
                    .select()
                    .from(schema.epgPrograms)
                    .where(eq(schema.epgPrograms.channelId, channel[0].id))
                    .orderBy(schema.epgPrograms.start)
                    .limit(500);

                return results.map(this.transformDbRowToEpgProgram);
            }

            return [];
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting channel programs:',
                error
            );
            return [];
        }
    }

    /**
     * Get all channels from database
     */
    private static async handleGetAllChannels(): Promise<{
        channels: Array<{ id: string; displayName: string }>;
        programs: never[];
    }> {
        try {
            const db = await getDatabase();
            const channels = await db
                .select({
                    id: schema.epgChannels.id,
                    displayName: schema.epgChannels.displayName,
                })
                .from(schema.epgChannels)
                .orderBy(schema.epgChannels.displayName);

            return { channels, programs: [] };
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting all channels:',
                error
            );
            return { channels: [], programs: [] };
        }
    }

    /**
     * Get channels by range (for pagination) with their programs
     */
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
        try {
            const db = await getDatabase();
            const channels = await db
                .select({
                    id: schema.epgChannels.id,
                    displayName: schema.epgChannels.displayName,
                    iconUrl: schema.epgChannels.iconUrl,
                })
                .from(schema.epgChannels)
                .orderBy(schema.epgChannels.displayName)
                .offset(skip)
                .limit(limit);

            // Fetch programs for each channel
            const channelsWithPrograms = await Promise.all(
                channels.map(async (channel) => {
                    const programs = await db
                        .select()
                        .from(schema.epgPrograms)
                        .where(eq(schema.epgPrograms.channelId, channel.id))
                        .orderBy(schema.epgPrograms.start);

                    return {
                        ...channel,
                        programs: programs.map(this.transformDbRowToEpgProgram),
                    };
                })
            );

            return channelsWithPrograms;
        } catch (error) {
            console.error(
                this.loggerLabel,
                'Error getting channels by range:',
                error
            );
            return [];
        }
    }

    /**
     * Clear all EPG data using worker thread to avoid blocking main thread
     */
    static async clearEpgData(): Promise<void> {
        return new Promise((resolve, reject) => {
            let workerPath: string;

            if (app.isPackaged) {
                const resourcesPath = path.dirname(app.getAppPath());
                workerPath = path.join(
                    resourcesPath,
                    'dist',
                    'apps',
                    'electron-backend',
                    'workers',
                    'epg-parser.worker.js'
                );
            } else {
                workerPath = path.join(
                    __dirname,
                    'workers',
                    'epg-parser.worker.js'
                );
            }

            let worker: Worker;
            try {
                const workerURL = pathToFileURL(workerPath);
                // In packaged app, native modules are in app.asar.unpacked/node_modules
                const nativeModulesPath = app.isPackaged
                    ? path.join(
                          path.dirname(app.getAppPath()),
                          'app.asar.unpacked',
                          'node_modules'
                      )
                    : undefined;
                worker = new Worker(workerURL, {
                    workerData: { nativeModulesPath },
                });
            } catch (error) {
                console.error(
                    this.loggerLabel,
                    'Failed to create worker for clear:',
                    error
                );
                reject(error);
                return;
            }

            worker.on(
                'message',
                (message: { type: string; error?: string }) => {
                    if (message.type === 'READY') {
                        worker.postMessage({ type: 'CLEAR_EPG' });
                    } else if (message.type === 'CLEAR_COMPLETE') {
                        console.log(
                            this.loggerLabel,
                            'EPG data cleared via worker'
                        );
                        this.fetchedUrls.clear();
                        // Terminate any running fetch workers
                        this.workers.forEach((w) => w.terminate());
                        this.workers.clear();
                        worker.terminate();
                        resolve();
                    } else if (message.type === 'EPG_ERROR') {
                        console.error(
                            this.loggerLabel,
                            'Worker clear error:',
                            message.error
                        );
                        worker.terminate();
                        reject(new Error(message.error || 'Clear failed'));
                    }
                }
            );

            worker.on('error', (error) => {
                console.error(
                    this.loggerLabel,
                    'Worker error during clear:',
                    error
                );
                worker.terminate();
                reject(error);
            });
        });
    }
}
