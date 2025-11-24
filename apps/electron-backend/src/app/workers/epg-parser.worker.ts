import { parse as parseEpg } from 'epg-parser';
import { EpgData, EpgProgram } from 'shared-interfaces';
import { parentPort } from 'worker_threads';
import { gunzipSync } from 'zlib';

/**
 * EPG Parser Worker
 * Runs in a separate thread to avoid blocking the main process
 * Compatible with epg-parser v0.4.0
 */

interface WorkerMessage {
    type: 'FETCH_EPG' | 'FORCE_FETCH';
    url: string;
}

interface WorkerResponse {
    type: 'EPG_PARSED' | 'EPG_ERROR' | 'EPG_PROGRESS' | 'READY';
    data?: EpgData;
    error?: string;
    url?: string;
}

const loggerLabel = '[EPG Worker]';

/**
 * Fetches and parses EPG data from URL
 */
async function fetchAndParseEpg(url: string): Promise<EpgData> {
    try {
        const isGzipped = url.endsWith('.gz');

        // Use native fetch (available in Node.js 18+)
        const response = await fetch(url.trim());

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        let xmlString: string;

        if (isGzipped) {
            // For gzipped files, get as ArrayBuffer
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const decompressed = gunzipSync(buffer);
            xmlString = decompressed.toString('utf-8');
        } else {
            // For regular files, get as text
            xmlString = await response.text();
        }

        const parsed = parseEpg(xmlString);

        // Normalize data to match our interface
        const normalized: EpgData = {
            channels: parsed.channels.map(
                (channel: Record<string, unknown>) => ({
                    id: channel.id as string,
                    displayName:
                        (channel.displayName as {
                            lang: string;
                            value: string;
                        }[]) || [],
                    icon:
                        (channel.icon as {
                            src: string;
                            width?: number;
                            height?: number;
                        }[]) || [],
                    url: (channel.url as string[]) || [],
                })
            ),
            programs: parsed.programs.map(
                (program: Record<string, unknown>) => ({
                    ...program,
                    start: program.start as string, // Already ISO string in v0.4.0
                    stop: program.stop as string, // Already ISO string in v0.4.0
                    date:
                        typeof program.date === 'string'
                            ? program.date
                            : (program.date as string[])?.[0] || '',
                })
            ) as EpgProgram[],
        };

        return normalized;
    } catch (error) {
        console.error(
            loggerLabel,
            'Error fetching EPG:',
            error instanceof Error ? error.message : String(error)
        );
        throw error;
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
                const parsedData = await fetchAndParseEpg(message.url);

                const response: WorkerResponse = {
                    type: 'EPG_PARSED',
                    data: parsedData,
                    url: message.url,
                };

                parentPort?.postMessage(response);
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
