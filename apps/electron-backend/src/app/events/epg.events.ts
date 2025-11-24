import { app, ipcMain } from 'electron';
import * as path from 'path';
import { EpgChannelWithPrograms, EpgData, EpgProgram } from 'shared-interfaces';
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
        console.log('[EPG Events] Bootstrapping EPG events...');

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
            console.error('[EPG Events] Error fetching EPG:', error);
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
            console.log(this.loggerLabel, 'URL already fetched:', url);
            return;
        }

        return new Promise((resolve, reject) => {
            // Get the proper worker path following Electron's recommended approach
            // https://www.electronjs.org/docs/latest/tutorial/multithreading
            let workerPath: string;
            
            if (app.isPackaged) {
                // In packaged app: Resources/app.asar.unpacked/workers/epg-parser.worker.js
                const appPath = app.getAppPath();
                const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
                workerPath = path.join(unpackedPath, 'workers', 'epg-parser.worker.js');
            } else {
                // In development: dist/apps/electron-backend/workers/epg-parser.worker.js
                workerPath = path.join(__dirname, 'workers', 'epg-parser.worker.js');
            }

            console.log(this.loggerLabel, 'Creating worker for:', url);
            console.log(this.loggerLabel, 'Worker path:', workerPath);
            console.log(this.loggerLabel, 'App path:', app.getAppPath());
            console.log(this.loggerLabel, 'Is packaged:', app.isPackaged);
            console.log(this.loggerLabel, '__dirname:', __dirname);
            
            // Check if file exists
            const fs = require('fs');
            if (!fs.existsSync(workerPath)) {
                console.error(this.loggerLabel, 'Worker file does not exist at:', workerPath);
                console.error(this.loggerLabel, 'Trying alternate paths...');
                
                // Try alternate path with electron-backend subdirectory
                const alternatePath = path.join(
                    app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
                    'electron-backend',
                    'workers',
                    'epg-parser.worker.js'
                );
                console.error(this.loggerLabel, 'Alternate path:', alternatePath);
                
                if (fs.existsSync(alternatePath)) {
                    workerPath = alternatePath;
                    console.log(this.loggerLabel, 'Using alternate path');
                } else {
                    reject(new Error(`Worker file not found at ${workerPath} or ${alternatePath}`));
                    return;
                }
            }

            let worker: Worker;
            try {
                // Worker threads require file:// URLs wrapped in URL object for packaged apps
                const workerURL = pathToFileURL(workerPath);
                worker = new Worker(workerURL);
                console.log(this.loggerLabel, 'Worker created successfully');
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
                    data?: EpgData;
                    error?: string;
                    url?: string;
                }) => {
                    if (message.type === 'READY') {
                        console.log(
                            this.loggerLabel,
                            'Worker ready, sending fetch command'
                        );
                        worker.postMessage({ type: 'FETCH_EPG', url });
                    } else if (message.type === 'EPG_PARSED') {
                        console.log(
                            this.loggerLabel,
                            'EPG parsed in worker, merging data...'
                        );
                        if (message.data) {
                            this.mergeEpgData(message.data);
                            this.fetchedUrls.add(url);
                        }
                        worker.terminate();
                        this.workers.delete(url);
                        resolve();
                    } else if (message.type === 'EPG_ERROR') {
                        console.error(
                            this.loggerLabel,
                            'Worker error:',
                            message.error
                        );
                        worker.terminate();
                        this.workers.delete(url);
                        reject(new Error(message.error || 'Unknown error'));
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
     * Merge EPG data (optimized for large datasets)
     */
    private static mergeEpgData(newData: EpgData): void {
        console.log(
            this.loggerLabel,
            `Merging ${newData.channels.length} channels and ${newData.programs.length} programs...`
        );

        // Merge channels (avoid duplicates)
        const existingChannelIds = new Set(
            this.epgData.channels.map((c) => c.id)
        );
        const newChannels = newData.channels.filter(
            (c) => !existingChannelIds.has(c.id)
        );

        // Use concat instead of spread for large arrays
        this.epgData.channels = this.epgData.channels.concat(newChannels);

        // Merge programs in chunks to avoid stack overflow
        const chunkSize = 10000;
        for (let i = 0; i < newData.programs.length; i += chunkSize) {
            const chunk = newData.programs.slice(i, i + chunkSize);
            this.epgData.programs = this.epgData.programs.concat(chunk);
        }

        // Rebuild merged data structure
        this.rebuildMergedData();

        console.log(
            this.loggerLabel,
            `Merged EPG data: ${this.epgData.channels.length} channels, ${this.epgData.programs.length} programs`
        );
    }

    /**
     * Rebuild merged data structure (channels with programs)
     * Optimized for large datasets
     */
    private static rebuildMergedData(): void {
        console.log(this.loggerLabel, 'Rebuilding merged data structure...');
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

        console.log(
            this.loggerLabel,
            `Rebuild complete. ${this.epgDataMerged.size} channels with programs`
        );
    }

    /**
     * Get programs for a specific channel
     */
    private static handleGetChannelPrograms(channelId: string): EpgProgram[] {
        console.log('[EPG Events] Getting programs for channel:', channelId);
        console.log(
            '[EPG Events] Total merged channels:',
            this.epgDataMerged.size
        );

        // First try exact ID match
        let channelData = this.epgDataMerged.get(channelId);

        // If not found, try to find by display name
        if (!channelData) {
            console.log(
                '[EPG Events] No exact match, searching by display name...'
            );
            for (const [id, channel] of this.epgDataMerged.entries()) {
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
                    console.log(
                        '[EPG Events] Found match by name:',
                        id,
                        '→',
                        channel.displayName[0]?.value
                    );
                    channelData = channel;
                    break;
                }
            }
        }

        console.log(
            '[EPG Events] Found programs:',
            channelData?.programs?.length || 0
        );
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

        console.log(this.loggerLabel, 'EPG data cleared');
    }
}
