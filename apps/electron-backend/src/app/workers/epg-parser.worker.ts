import { EpgChannel, EpgProgram } from 'shared-interfaces';
import { parentPort } from 'worker_threads';
import { createGunzip } from 'zlib';
import { SaxesParser, SaxesTagPlain } from 'saxes';
import { Readable } from 'stream';

/**
 * Streaming EPG Parser Worker
 * Uses SAX parsing to process XML incrementally without loading entire file into memory.
 * Supports both regular and gzipped EPG files.
 */

interface WorkerMessage {
    type: 'FETCH_EPG' | 'FORCE_FETCH';
    url: string;
}

interface WorkerResponse {
    type:
        | 'EPG_CHANNELS_BATCH'
        | 'EPG_PROGRAMS_BATCH'
        | 'EPG_COMPLETE'
        | 'EPG_ERROR'
        | 'EPG_PROGRESS'
        | 'READY';
    channels?: EpgChannel[];
    programs?: EpgProgram[];
    error?: string;
    url?: string;
    stats?: {
        totalChannels: number;
        totalPrograms: number;
    };
}

const loggerLabel = '[EPG Worker]';

// Batch size for sending data back to main thread
const CHANNEL_BATCH_SIZE = 100;
const PROGRAM_BATCH_SIZE = 1000;

/**
 * Parse XMLTV datetime format to ISO string
 * Format: YYYYMMDDHHmmss +HHMM or YYYYMMDDHHmmss
 */
function parseXmltvDate(dateStr: string): string {
    if (!dateStr) return '';

    // Extract date parts: 20231225060000 +0000
    const match = dateStr.match(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/
    );

    if (!match) return dateStr;

    const [, year, month, day, hour, minute, second, tz] = match;

    // Build ISO string
    let isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

    if (tz) {
        // Convert +0000 to +00:00
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
    private channels: EpgChannel[] = [];
    private programs: EpgProgram[] = [];
    private totalChannels = 0;
    private totalPrograms = 0;

    // Current element being parsed
    private currentChannel: Partial<EpgChannel> | null = null;
    private currentProgram: Partial<EpgProgram> | null = null;
    private currentTextContent = '';
    private currentLang = '';

    // For nested elements
    private elementStack: string[] = [];

    constructor(private onChannelsBatch: (channels: EpgChannel[]) => void, private onProgramsBatch: (programs: EpgProgram[]) => void, private onProgress: (channels: number, programs: number) => void) {
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
                        previouslyShown: [],
                        subtitles: [],
                        icon: [],
                        rating: [],
                        credits: [],
                        audio: [],
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
                        // Rating has system attribute, value comes as child <value> element
                        const system =
                            (tag.attributes['system'] as string) || '';
                        // We'll complete this when we see the value element
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
                        // Channel complete, add to batch
                        this.channels.push(this.currentChannel as EpgChannel);
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
                        // This is for rating value
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
                        // Program complete, add to batch
                        this.programs.push(this.currentProgram as EpgProgram);
                        this.totalPrograms++;
                        this.currentProgram = null;

                        if (this.programs.length >= PROGRAM_BATCH_SIZE) {
                            this.flushPrograms();
                        }
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
        // Flush any remaining data
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
 */
async function fetchAndParseEpgStreaming(url: string): Promise<void> {
    const isGzipped = url.endsWith('.gz');

    console.log(
        loggerLabel,
        `Fetching EPG from ${url} (gzipped: ${isGzipped})`
    );

    const response = await fetch(url.trim());

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
        throw new Error('Response body is null');
    }

    const parser = new StreamingEpgParser(
        (channels) => {
            const response: WorkerResponse = {
                type: 'EPG_CHANNELS_BATCH',
                channels,
            };
            parentPort?.postMessage(response);
        },
        (programs) => {
            const response: WorkerResponse = {
                type: 'EPG_PROGRAMS_BATCH',
                programs,
            };
            parentPort?.postMessage(response);
        },
        (totalChannels, totalPrograms) => {
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
                reject(err);
            });
        }

        dataStream.on('data', (chunk: Buffer) => {
            try {
                parser.write(chunk.toString('utf-8'));
            } catch (err) {
                console.error(loggerLabel, 'Parse error:', err);
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

                const response: WorkerResponse = {
                    type: 'EPG_COMPLETE',
                    url,
                    stats,
                };
                parentPort?.postMessage(response);
                resolve();
            } catch (err) {
                reject(err);
            }
        });

        dataStream.on('error', (err) => {
            console.error(loggerLabel, 'Stream error:', err);
            reject(err);
        });
    });
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
                await fetchAndParseEpgStreaming(message.url);
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
