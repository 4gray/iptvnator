import { app, ipcMain } from 'electron';
import * as path from 'path';
import {
    EpgChannel,
    EpgChannelWithPrograms,
    EpgData,
    EpgProgram,
} from 'shared-interfaces';
import { Worker } from 'worker_threads';
import { pathToFileURL } from 'url';

/**
 * EPG Events Handler
 * Manages EPG data fetching and querying using worker threads
 */
export default class EpgEvents {
    private static epgData: EpgData = {
        channels: [],
        programs: [],
    };

    private static epgDataMerged: Map<string, EpgChannelWithPrograms> =
        new Map();
    private static fetchedUrls: Set<string> = new Set();
    private static workers: Map<string, Worker> = new Map();
    private static readonly loggerLabel = '[EPG Events]';

    /**
     * Bootstrap EPG events
     */
    static bootstrapEpgEvents(): Electron.IpcMain {
        // Fetch EPG from URLs
        ipcMain.handle('FETCH_EPG', async (event, args: { url: string[] }) => {
            return await this.handleFetchEpg(args.url);
        });

        // Get programs for a specific channel
        ipcMain.handle(
            'GET_CHANNEL_PROGRAMS',
            async (event, args: { channelId: string }) => {
                return this.handleGetChannelPrograms(args.channelId);
            }
        );

        // Get all channels
        ipcMain.handle('EPG_GET_CHANNELS', async () => {
            return this.epgData;
        });

        // Get channels by range (pagination)
        ipcMain.handle(
            'EPG_GET_CHANNELS_BY_RANGE',
            async (event, args: { skip: number; limit: number }) => {
                return this.handleGetChannelsByRange(args.skip, args.limit);
            }
        );

        // Force fetch (ignore cache)
        ipcMain.handle('EPG_FORCE_FETCH', async (event, url: string) => {
            this.fetchedUrls.delete(url);
            return await this.handleFetchEpg([url]);
        });

        return ipcMain;
    }

    /**
     * Handle EPG fetch from URLs
     */
    private static async handleFetchEpg(
        urls: string[]
    ): Promise<{ success: boolean; message?: string }> {
        const validUrls = urls.filter((url) => url?.trim());

        if (validUrls.length === 0) {
            return { success: false, message: 'No valid URLs provided' };
        }

        const promises = validUrls.map((url) => this.fetchEpgFromUrl(url));

        try {
            await Promise.all(promises);
            return { success: true };
        } catch (error) {
            console.error(this.loggerLabel, 'Error fetching EPG:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Fetch EPG from a single URL using worker thread
     */
    private static async fetchEpgFromUrl(url: string): Promise<void> {
        // Skip if already fetched
        if (this.fetchedUrls.has(url)) {
            return;
        }

        return new Promise((resolve, reject) => {
            let workerPath: string;

            if (app.isPackaged) {
                // In packaged app: Resources/dist/apps/electron-backend/workers/epg-parser.worker.js
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
                // In development: dist/apps/electron-backend/workers/epg-parser.worker.js
                workerPath = path.join(__dirname, 'workers', 'epg-parser.worker.js');
            }

            let worker: Worker;
            try {
                // Worker threads require file:// URLs wrapped in URL object for packaged apps
                const workerURL = pathToFileURL(workerPath);
                worker = new Worker(workerURL, {
                    // Increase memory limits for large EPG files
                    resourceLimits: {
                        maxOldGenerationSizeMb: 4096, // 4GB for parsed data
                        maxYoungGenerationSizeMb: 512, // 512MB for temporary allocations
                    },
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
                (message: {
                    type: string;
                    channels?: EpgChannel[];
                    programs?: EpgProgram[];
                    error?: string;
                    url?: string;
                    stats?: { totalChannels: number; totalPrograms: number };
                }) => {
                    switch (message.type) {
                        case 'READY':
                            worker.postMessage({ type: 'FETCH_EPG', url });
                            break;

                        case 'EPG_CHANNELS_BATCH':
                            // Add channels incrementally
                            if (message.channels) {
                                this.addChannelsBatch(message.channels);
                            }
                            break;

                        case 'EPG_PROGRAMS_BATCH':
                            // Add programs incrementally
                            if (message.programs) {
                                this.addProgramsBatch(message.programs);
                            }
                            break;

                        case 'EPG_PROGRESS':
                            // Log progress for large files
                            if (message.stats) {
                                console.log(
                                    this.loggerLabel,
                                    `Progress: ${message.stats.totalChannels} channels, ${message.stats.totalPrograms} programs`
                                );
                            }
                            break;

                        case 'EPG_COMPLETE':
                            console.log(
                                this.loggerLabel,
                                `EPG parsing complete for ${url}:`,
                                message.stats
                            );
                            this.rebuildMergedData();
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
                            worker.terminate();
                            this.workers.delete(url);
                            reject(new Error(message.error || 'Unknown error'));
                            break;
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
     * Add a batch of channels (streaming mode)
     */
    private static addChannelsBatch(channels: EpgChannel[]): void {
        // Use Set for O(1) duplicate checking
        const existingIds = new Set(this.epgData.channels.map((c) => c.id));
        const newChannels = channels.filter((c) => !existingIds.has(c.id));
        this.epgData.channels = this.epgData.channels.concat(newChannels);
    }

    /**
     * Add a batch of programs (streaming mode)
     */
    private static addProgramsBatch(programs: EpgProgram[]): void {
        // Simply append programs - no duplicate check needed as each program is unique
        this.epgData.programs = this.epgData.programs.concat(programs);
    }

    /**
     * Rebuild merged data structure (channels with programs)
     * Optimized for large datasets
     */
    private static rebuildMergedData(): void {
        this.epgDataMerged.clear();

        // Create channel lookup map for O(1) access
        const channelMap = new Map(this.epgData.channels.map((c) => [c.id, c]));

        // Group programs by channel in a single pass
        const programsByChannel = new Map<string, EpgProgram[]>();

        for (const program of this.epgData.programs) {
            const channelId = program.channel;
            if (!programsByChannel.has(channelId)) {
                programsByChannel.set(channelId, []);
            }
            programsByChannel.get(channelId)!.push(program);
        }

        // Build merged structure
        for (const [channelId, programs] of programsByChannel.entries()) {
            const channel = channelMap.get(channelId);
            if (channel) {
                this.epgDataMerged.set(channelId, {
                    ...channel,
                    programs,
                });
            }
        }
    }

    /**
     * Get programs for a specific channel
     */
    private static handleGetChannelPrograms(channelId: string): EpgProgram[] {
        // First try exact ID match
        let channelData = this.epgDataMerged.get(channelId);

        // If not found, try to find by display name
        if (!channelData) {
            for (const [, channel] of this.epgDataMerged.entries()) {
                const displayNames = channel.displayName.map((d) =>
                    d.value.toLowerCase()
                );
                if (
                    displayNames.some(
                        (name) =>
                            name === channelId.toLowerCase() ||
                            name.includes(channelId.toLowerCase()) ||
                            channelId.toLowerCase().includes(name)
                    )
                ) {
                    channelData = channel;
                    break;
                }
            }
        }

        return channelData?.programs || [];
    }

    /**
     * Get channels by range (for pagination)
     */
    private static handleGetChannelsByRange(
        skip: number,
        limit: number
    ): EpgChannelWithPrograms[] {
        const channels = Array.from(this.epgDataMerged.values());
        return channels.slice(skip, skip + limit);
    }

    /**
     * Clear all EPG data
     */
    static clearEpgData(): void {
        this.epgData = { channels: [], programs: [] };
        this.epgDataMerged.clear();
        this.fetchedUrls.clear();

        // Terminate all workers
        this.workers.forEach((worker) => worker.terminate());
        this.workers.clear();
    }
}
