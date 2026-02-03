import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { homedir } from 'os';
import { join } from 'path';
import { SaxesParser, SaxesTagPlain } from 'saxes';
import { Readable } from 'stream';
import { parentPort, workerData } from 'worker_threads';
import { createGunzip } from 'zlib';

// In packaged app, native modules are in app.asar.unpacked/node_modules
// which is separate from the worker location in extraResources
let Database: typeof BetterSqlite3;

function loadBetterSqlite3(): typeof BetterSqlite3 {
    // Try workerData path first (passed from main process)
    if (
        workerData?.nativeModulesPath &&
        existsSync(workerData.nativeModulesPath)
    ) {
        try {
            const nativeRequire = createRequire(
                join(workerData.nativeModulesPath, 'index.js')
            );
            return nativeRequire('better-sqlite3');
        } catch (e) {
            console.error(
                '[EPG Worker] Failed to load from workerData path:',
                e
            );
        }
    }

    // Try process.resourcesPath (available in packaged Electron apps)
    if (
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ) {
        const resourcesPath = (
            process as NodeJS.Process & { resourcesPath?: string }
        ).resourcesPath!;
        const unpackedPath = join(
            resourcesPath,
            'app.asar.unpacked',
            'node_modules'
        );
        if (existsSync(unpackedPath)) {
            try {
                const nativeRequire = createRequire(
                    join(unpackedPath, 'index.js')
                );
                return nativeRequire('better-sqlite3');
            } catch (e) {
                console.error(
                    '[EPG Worker] Failed to load from resourcesPath:',
                    e
                );
            }
        }
    }

    // Fallback to regular require (development mode)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('better-sqlite3');
}

Database = loadBetterSqlite3();

/**
 * Internal parsing types with arrays for XML parsing
 * These are different from the flat EpgProgram interface used by the frontend
 */
interface ParsedTextValue {
    lang: string;
    value: string;
}

interface ParsedIcon {
    src: string;
    width?: number;
    height?: number;
}

interface ParsedRating {
    system: string;
    value: string;
}

interface ParsedEpisodeNum {
    system: string;
    value: string;
}

interface ParsedChannel {
    id: string;
    displayName: ParsedTextValue[];
    icon: ParsedIcon[];
    url: string[];
}

interface ParsedProgram {
    start: string;
    stop: string;
    channel: string;
    title: ParsedTextValue[];
    desc: ParsedTextValue[];
    category: ParsedTextValue[];
    date: string;
    episodeNum: ParsedEpisodeNum[];
    icon: ParsedIcon[];
    rating: ParsedRating[];
}

/**
 * Streaming EPG Parser Worker
 * Uses SAX parsing to process XML incrementally without loading entire file into memory.
 * Supports both regular and gzipped EPG files.
 * Performs database operations directly to avoid blocking the main thread.
 */

interface WorkerMessage {
    type: 'FETCH_EPG' | 'FORCE_FETCH' | 'CLEAR_EPG';
    url?: string;
}

interface WorkerResponse {
    type:
        | 'EPG_COMPLETE'
        | 'EPG_ERROR'
        | 'EPG_PROGRESS'
        | 'CLEAR_COMPLETE'
        | 'READY';
    error?: string;
    url?: string;
    stats?: {
        totalChannels: number;
        totalPrograms: number;
    };
}

const loggerLabel = '[EPG Worker]';

// Batch size for database inserts
const CHANNEL_BATCH_SIZE = 100;
const PROGRAM_BATCH_SIZE = 1000;

/**
 * Get database file path (same as main app)
 */
function getDatabasePath(): string {
    const dbDir = join(homedir(), '.iptvnator', 'databases');
    if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
    }
    return join(dbDir, 'iptvnator.db');
}

/**
 * Database helper class for EPG operations
 * Creates its own connection to avoid blocking main thread
 */
class EpgDatabase {
    private db: BetterSqlite3.Database;
    private knownChannelIds: Set<string> = new Set();

    // Prepared statements for better performance
    private insertChannelStmt: BetterSqlite3.Statement;
    private insertProgramStmt: BetterSqlite3.Statement;
    private deleteChannelsStmt: BetterSqlite3.Statement;

    constructor() {
        const dbPath = getDatabasePath();
        this.db = new Database(dbPath);
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('journal_mode = WAL'); // Better concurrent write performance

        // Prepare statements
        // Use INSERT OR REPLACE to update existing channels and refresh updated_at
        // Use strftime with ISO format for consistent date comparison
        this.insertChannelStmt = this.db.prepare(`
            INSERT INTO epg_channels (id, display_name, icon_url, url, source_url, updated_at)
            VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                icon_url = excluded.icon_url,
                url = excluded.url,
                source_url = excluded.source_url,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        `);

        this.insertProgramStmt = this.db.prepare(`
            INSERT INTO epg_programs (channel_id, start, stop, title, description, category, icon_url, rating, episode_num)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.deleteChannelsStmt = this.db.prepare(`
            DELETE FROM epg_channels WHERE source_url = ?
        `);
    }

    /**
     * Clear existing EPG data for a source URL
     */
    clearSourceData(sourceUrl: string): void {
        this.deleteChannelsStmt.run(sourceUrl);
        this.knownChannelIds.clear();
    }

    /**
     * Insert a batch of channels
     */
    insertChannels(channels: ParsedChannel[], sourceUrl: string): void {
        const insertMany = this.db.transaction((channels: ParsedChannel[]) => {
            for (const channel of channels) {
                const displayName =
                    channel.displayName?.[0]?.value || channel.id;
                const iconUrl = channel.icon?.[0]?.src || null;
                const url = channel.url?.[0] || null;

                this.insertChannelStmt.run(
                    channel.id,
                    displayName,
                    iconUrl,
                    url,
                    sourceUrl
                );
                this.knownChannelIds.add(channel.id);
            }
        });

        insertMany(channels);
    }

    /**
     * Insert a batch of programs
     * Only inserts programs for known channels to avoid FK constraint failures
     */
    insertPrograms(programs: ParsedProgram[]): number {
        let insertedCount = 0;

        const insertMany = this.db.transaction((programs: ParsedProgram[]) => {
            for (const prog of programs) {
                // Skip if channel not known
                if (!this.knownChannelIds.has(prog.channel)) continue;

                const title = prog.title?.[0]?.value || 'Unknown';
                const description = prog.desc?.[0]?.value || null;
                const category = prog.category?.[0]?.value || null;
                const iconUrl = prog.icon?.[0]?.src || null;
                const rating = prog.rating?.[0]?.value || null;
                const episodeNum = prog.episodeNum?.[0]?.value || null;

                try {
                    this.insertProgramStmt.run(
                        prog.channel,
                        prog.start,
                        prog.stop,
                        title,
                        description,
                        category,
                        iconUrl,
                        rating,
                        episodeNum
                    );
                    insertedCount++;
                } catch (err) {
                    // Skip individual failures (e.g., FK constraint)
                }
            }
        });

        insertMany(programs);
        return insertedCount;
    }

    /**
     * Close the database connection
     */
    close(): void {
        this.db.close();
    }
}

/**
 * Parse XMLTV datetime format to ISO string
 * Format: YYYYMMDDHHmmss +HHMM or YYYYMMDDHHmmss
 */
function parseXmltvDate(dateStr: string): string {
    if (!dateStr) return '';

    const match = dateStr.match(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/
    );

    if (!match) return dateStr;

    const [, year, month, day, hour, minute, second, tz] = match;

    let isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

    if (tz) {
        isoString += `${tz.slice(0, 3)}:${tz.slice(3)}`;
    } else {
        isoString += 'Z';
    }

    return isoString;
}

/**
 * Streaming EPG parser using SAX
 */
class StreamingEpgParser {
    private parser: SaxesParser;
    private channels: ParsedChannel[] = [];
    private programs: ParsedProgram[] = [];
    private totalChannels = 0;
    private totalPrograms = 0;

    // Current element being parsed
    private currentChannel: Partial<ParsedChannel> | null = null;
    private currentProgram: Partial<ParsedProgram> | null = null;
    private currentTextContent = '';
    private currentLang = '';

    // For nested elements
    private elementStack: string[] = [];

    constructor(
        private onChannelsBatch: (channels: ParsedChannel[]) => void,
        private onProgramsBatch: (programs: ParsedProgram[]) => void,
        private onProgress: (channels: number, programs: number) => void
    ) {
        this.parser = new SaxesParser();
        this.setupParser();
    }

    private setupParser(): void {
        this.parser.on('opentag', (tag: SaxesTagPlain) => {
            this.elementStack.push(tag.name);
            this.currentTextContent = '';

            switch (tag.name) {
                case 'channel':
                    this.currentChannel = {
                        id: (tag.attributes['id'] as string) || '',
                        displayName: [],
                        icon: [],
                        url: [],
                    };
                    break;

                case 'programme':
                    this.currentProgram = {
                        start: parseXmltvDate(
                            (tag.attributes['start'] as string) || ''
                        ),
                        stop: parseXmltvDate(
                            (tag.attributes['stop'] as string) || ''
                        ),
                        channel: (tag.attributes['channel'] as string) || '',
                        title: [],
                        desc: [],
                        category: [],
                        date: '',
                        episodeNum: [],
                        icon: [],
                        rating: [],
                    };
                    break;

                case 'icon':
                    if (this.currentChannel) {
                        this.currentChannel.icon!.push({
                            src: (tag.attributes['src'] as string) || '',
                            width: tag.attributes['width']
                                ? parseInt(tag.attributes['width'] as string)
                                : undefined,
                            height: tag.attributes['height']
                                ? parseInt(tag.attributes['height'] as string)
                                : undefined,
                        });
                    } else if (this.currentProgram) {
                        this.currentProgram.icon!.push({
                            src: (tag.attributes['src'] as string) || '',
                            width: tag.attributes['width']
                                ? parseInt(tag.attributes['width'] as string)
                                : undefined,
                            height: tag.attributes['height']
                                ? parseInt(tag.attributes['height'] as string)
                                : undefined,
                        });
                    }
                    break;

                case 'display-name':
                case 'title':
                case 'desc':
                case 'category':
                    this.currentLang = (tag.attributes['lang'] as string) || '';
                    break;

                case 'rating':
                    if (this.currentProgram) {
                        const system =
                            (tag.attributes['system'] as string) || '';
                        this.currentProgram.rating!.push({ system, value: '' });
                    }
                    break;

                case 'episode-num':
                    if (this.currentProgram) {
                        const system =
                            (tag.attributes['system'] as string) || '';
                        this.currentProgram.episodeNum!.push({
                            system,
                            value: '',
                        });
                    }
                    break;
            }
        });

        this.parser.on('text', (text: string) => {
            this.currentTextContent += text;
        });

        this.parser.on('closetag', (tag: SaxesTagPlain) => {
            const text = this.currentTextContent.trim();

            if (this.currentChannel) {
                switch (tag.name) {
                    case 'display-name':
                        this.currentChannel.displayName!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'url':
                        if (text) this.currentChannel.url!.push(text);
                        break;
                    case 'channel':
                        this.channels.push(
                            this.currentChannel as ParsedChannel
                        );
                        this.totalChannels++;
                        this.currentChannel = null;

                        if (this.channels.length >= CHANNEL_BATCH_SIZE) {
                            this.flushChannels();
                        }
                        break;
                }
            }

            if (this.currentProgram) {
                switch (tag.name) {
                    case 'title':
                        this.currentProgram.title!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'desc':
                        this.currentProgram.desc!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'category':
                        this.currentProgram.category!.push({
                            lang: this.currentLang,
                            value: text,
                        });
                        break;
                    case 'date':
                        this.currentProgram.date = text;
                        break;
                    case 'value':
                        if (
                            this.elementStack.includes('rating') &&
                            this.currentProgram.rating!.length > 0
                        ) {
                            this.currentProgram.rating![
                                this.currentProgram.rating!.length - 1
                            ].value = text;
                        }
                        break;
                    case 'episode-num':
                        if (this.currentProgram.episodeNum!.length > 0) {
                            this.currentProgram.episodeNum![
                                this.currentProgram.episodeNum!.length - 1
                            ].value = text;
                        }
                        break;
                    case 'programme':
                        this.programs.push(
                            this.currentProgram as ParsedProgram
                        );
                        this.totalPrograms++;

                        if (this.programs.length >= PROGRAM_BATCH_SIZE) {
                            this.flushPrograms();
                        }
                        this.currentProgram = null;
                        break;
                }
            }

            this.elementStack.pop();
            this.currentTextContent = '';
        });

        this.parser.on('error', (err: Error) => {
            console.error(loggerLabel, 'Parser error:', err.message);
        });
    }

    private flushChannels(): void {
        if (this.channels.length > 0) {
            this.onChannelsBatch([...this.channels]);
            this.channels = [];
            this.onProgress(this.totalChannels, this.totalPrograms);
        }
    }

    private flushPrograms(): void {
        if (this.programs.length > 0) {
            this.onProgramsBatch([...this.programs]);
            this.programs = [];
            this.onProgress(this.totalChannels, this.totalPrograms);
        }
    }

    write(chunk: string): void {
        this.parser.write(chunk);
    }

    finish(): { totalChannels: number; totalPrograms: number } {
        this.parser.close();
        this.flushChannels();
        this.flushPrograms();

        return {
            totalChannels: this.totalChannels,
            totalPrograms: this.totalPrograms,
        };
    }
}

/**
 * Fetches and parses EPG data from URL using streaming
 * Inserts directly into SQLite to avoid blocking main thread
 */
async function fetchAndParseEpgStreaming(url: string): Promise<void> {
    const isGzipped = url.endsWith('.gz');

    console.log(
        loggerLabel,
        `Fetching EPG from ${url} (gzipped: ${isGzipped})`
    );

    // Create database connection in worker
    const epgDb = new EpgDatabase();

    try {
        // Clear existing data for this source
        console.log(loggerLabel, `Clearing existing data for ${url}`);
        epgDb.clearSourceData(url);

        const response = await fetch(url.trim());

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
            throw new Error('Response body is null');
        }

        const parser = new StreamingEpgParser(
            (channels) => {
                // Insert channels directly into database
                epgDb.insertChannels(channels, url);
            },
            (programs) => {
                // Insert programs directly into database
                epgDb.insertPrograms(programs);
            },
            (totalChannels, totalPrograms) => {
                // Send progress to main thread (lightweight)
                const response: WorkerResponse = {
                    type: 'EPG_PROGRESS',
                    stats: { totalChannels, totalPrograms },
                };
                parentPort?.postMessage(response);
            }
        );

        // Convert web stream to Node.js stream
        const nodeStream = Readable.fromWeb(response.body as any);

        return new Promise((resolve, reject) => {
            let dataStream: Readable = nodeStream;

            if (isGzipped) {
                const gunzip = createGunzip();
                dataStream = nodeStream.pipe(gunzip);

                gunzip.on('error', (err) => {
                    console.error(loggerLabel, 'Gunzip error:', err);
                    epgDb.close();
                    reject(err);
                });
            }

            dataStream.on('data', (chunk: Buffer) => {
                try {
                    parser.write(chunk.toString('utf-8'));
                } catch (err) {
                    console.error(loggerLabel, 'Parse error:', err);
                    epgDb.close();
                    reject(err);
                }
            });

            dataStream.on('end', () => {
                try {
                    const stats = parser.finish();
                    console.log(
                        loggerLabel,
                        `Parsing complete: ${stats.totalChannels} channels, ${stats.totalPrograms} programs`
                    );

                    // Close database connection
                    epgDb.close();

                    const response: WorkerResponse = {
                        type: 'EPG_COMPLETE',
                        url,
                        stats: {
                            totalChannels: stats.totalChannels,
                            totalPrograms: stats.totalPrograms,
                        },
                    };
                    parentPort?.postMessage(response);
                    resolve();
                } catch (err) {
                    epgDb.close();
                    reject(err);
                }
            });

            dataStream.on('error', (err) => {
                console.error(loggerLabel, 'Stream error:', err);
                epgDb.close();
                reject(err);
            });
        });
    } catch (error) {
        epgDb.close();
        throw error;
    }
}

/**
 * Clears all EPG data from the database
 * Runs in worker thread to avoid blocking main thread
 */
function clearAllEpgData(): void {
    const dbPath = getDatabasePath();
    const db = new Database(dbPath);

    try {
        console.log(loggerLabel, 'Clearing all EPG data...');

        // Delete programs first (foreign key constraint)
        db.exec('DELETE FROM epg_programs');
        // Then delete channels
        db.exec('DELETE FROM epg_channels');

        console.log(loggerLabel, 'All EPG data cleared');

        const response: WorkerResponse = { type: 'CLEAR_COMPLETE' };
        parentPort?.postMessage(response);
    } catch (error) {
        console.error(loggerLabel, 'Error clearing EPG data:', error);
        const errorResponse: WorkerResponse = {
            type: 'EPG_ERROR',
            error: error instanceof Error ? error.message : String(error),
        };
        parentPort?.postMessage(errorResponse);
    } finally {
        db.close();
    }
}

/**
 * Worker message handler
 */
if (parentPort) {
    parentPort.on('message', async (message: WorkerMessage) => {
        try {
            if (
                message.type === 'FETCH_EPG' ||
                message.type === 'FORCE_FETCH'
            ) {
                await fetchAndParseEpgStreaming(message.url!);
            } else if (message.type === 'CLEAR_EPG') {
                clearAllEpgData();
            }
        } catch (error) {
            console.error(loggerLabel, 'Worker error:', error);
            const errorResponse: WorkerResponse = {
                type: 'EPG_ERROR',
                error: error instanceof Error ? error.message : String(error),
                url: message.url,
            };
            parentPort?.postMessage(errorResponse);
        }
    });

    // Notify parent that worker is ready
    parentPort.postMessage({ type: 'READY' });
} else {
    console.error(loggerLabel, 'parentPort is not available!');
}
