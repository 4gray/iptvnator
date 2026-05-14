import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { open } from 'fs/promises';
import * as http from 'http';
import * as https from 'https';
import { dirname } from 'path';

const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_PARALLELISM = 10;
const MIN_PARALLELISM = 2;
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface AcceleratedDownloadProgress {
    bytesDownloaded: number;
    totalBytes: number;
    activeConnections: number;
    completedChunks: number;
    totalChunks: number;
    retries: number;
}

export interface AcceleratedDownloadOptions {
    url: string;
    filePath: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    chunkBytes?: number;
    parallelism?: number;
    retries?: number;
    timeoutMs?: number;
    onProgress?: (
        progress: AcceleratedDownloadProgress
    ) => void | Promise<void>;
}

export interface AcceleratedDownloadResult {
    filePath: string;
    totalBytes: number;
    bytesDownloaded: number;
    directUrl: string;
    contentType?: string;
    chunks: number;
    retries: number;
}

export interface AcceleratedPlaybackResolution {
    url: string;
    accelerated: boolean;
    rangeSupported: boolean;
    status: number;
    reason: string;
    totalBytes?: number;
}

export interface HttpDownloadBenchmarkSample {
    second: number;
    bytes: number;
    bytesPerSecond: number;
}

export interface HttpDownloadBenchmarkResult {
    url: string;
    finalUrl: string;
    ok: boolean;
    status: number;
    rangeRequested: boolean;
    rangeSupported: boolean;
    ttfbMs: number;
    durationMs: number;
    bytesRead: number;
    totalBytes?: number;
    contentLength?: number;
    contentType?: string;
    throughputBytesPerSecond: number;
    samples: HttpDownloadBenchmarkSample[];
    error?: string;
}

export interface HttpDownloadBenchmarkOptions {
    url: string;
    headers?: Record<string, string>;
    maxBytes?: number;
    timeoutMs?: number;
}

interface RangeProbeResult {
    directUrl: string;
    totalBytes: number;
    contentType?: string;
}

interface RequestResult {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
    finalUrl: string;
}

interface ChunkTask {
    index: number;
    start: number;
    end: number;
}

export class AcceleratedDownloadUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AcceleratedDownloadUnavailableError';
    }
}

export async function downloadWithAcceleratedHttp(
    options: AcceleratedDownloadOptions
): Promise<AcceleratedDownloadResult> {
    if (!isHttpUrl(options.url)) {
        throw new AcceleratedDownloadUnavailableError(
            'Only HTTP(S) downloads can use accelerated mode'
        );
    }

    const probe = await probeRangeSupport(options.url, options);
    const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    const maxParallelism = Math.max(
        MIN_PARALLELISM,
        options.parallelism ?? DEFAULT_PARALLELISM
    );
    const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
    const tempPath = `${options.filePath}.part`;

    mkdirSync(dirname(options.filePath), { recursive: true });
    for (const path of [tempPath, options.filePath]) {
        if (existsSync(path)) {
            unlinkSync(path);
        }
    }

    const chunks = buildChunks(probe.totalBytes, chunkBytes);
    const file = await open(tempPath, 'w');
    await file.truncate(probe.totalBytes);

    let directUrl = probe.directUrl;
    let nextChunk = 0;
    let activeConnections = 0;
    let completedChunks = 0;
    let bytesDownloaded = 0;
    let retryCount = 0;
    let currentParallelism = maxParallelism;
    let fatalError: Error | null = null;
    const retryQueue: ChunkTask[] = [];
    const failedChunks = new Map<number, number>();

    const reportProgress = async () => {
        await options.onProgress?.({
            bytesDownloaded,
            totalBytes: probe.totalBytes,
            activeConnections,
            completedChunks,
            totalChunks: chunks.length,
            retries: retryCount,
        });
    };

    const takeNextChunk = (): ChunkTask | null => {
        const retry = retryQueue.shift();
        if (retry) return retry;
        if (nextChunk >= chunks.length) return null;
        const chunk = chunks[nextChunk];
        nextChunk += 1;
        return chunk;
    };

    const markRetry = async (chunk: ChunkTask, status?: number) => {
        const attempts = failedChunks.get(chunk.index) ?? 0;
        if (attempts >= retries) {
            throw new Error(
                `Failed chunk ${chunk.index} after ${attempts + 1} attempts`
            );
        }

        failedChunks.set(chunk.index, attempts + 1);
        retryCount += 1;
        retryQueue.push(chunk);

        if (status === 509 || status === 429 || status === 503) {
            currentParallelism = Math.max(
                MIN_PARALLELISM,
                currentParallelism - 1
            );
        }

        if (
            status === 401 ||
            status === 403 ||
            status === 404 ||
            (typeof status === 'number' && status >= 500)
        ) {
            try {
                directUrl = (await probeRangeSupport(options.url, options))
                    .directUrl;
            } catch {
                // Keep the current direct URL; the retry may still succeed.
            }
        }
    };

    async function worker() {
        while (!options.signal?.aborted && !fatalError) {
            if (activeConnections >= currentParallelism) {
                await sleep(50);
                continue;
            }

            const chunk = takeNextChunk();
            if (!chunk) {
                return;
            }

            activeConnections += 1;
            try {
                const result = await fetchRange(directUrl, chunk, options);
                const expectedBytes = chunk.end - chunk.start + 1;

                if (
                    result.status !== 206 ||
                    result.body.length !== expectedBytes
                ) {
                    await markRetry(chunk, result.status);
                    continue;
                }

                await file.write(
                    result.body,
                    0,
                    result.body.length,
                    chunk.start
                );
                completedChunks += 1;
                bytesDownloaded += result.body.length;
                await reportProgress();
            } catch (error) {
                if (options.signal?.aborted) {
                    throw error;
                }
                await markRetry(chunk);
            } finally {
                activeConnections -= 1;
            }
        }
    }

    try {
        const workers = Array.from({ length: maxParallelism }, async () => {
            try {
                await worker();
            } catch (error) {
                fatalError =
                    error instanceof Error ? error : new Error(String(error));
            }
        });
        await Promise.all(workers);

        if (options.signal?.aborted) {
            throw new Error('Download canceled');
        }

        if (fatalError) {
            throw fatalError;
        }

        if (completedChunks !== chunks.length) {
            throw new Error(
                `Accelerated download incomplete: ${completedChunks}/${chunks.length} chunks`
            );
        }

        await file.close();
        renameSync(tempPath, options.filePath);
        await reportProgress();

        return {
            filePath: options.filePath,
            totalBytes: probe.totalBytes,
            bytesDownloaded,
            directUrl,
            contentType: probe.contentType,
            chunks: chunks.length,
            retries: retryCount,
        };
    } catch (error) {
        await file.close().catch(() => undefined);
        if (existsSync(tempPath)) {
            unlinkSync(tempPath);
        }
        throw error;
    }
}

export async function canAccelerateUrl(
    url: string,
    headers?: Record<string, string>
): Promise<boolean> {
    try {
        await probeRangeSupport(url, { headers });
        return true;
    } catch {
        return false;
    }
}

export async function resolveAcceleratedPlaybackUrl(
    url: string,
    headers?: Record<string, string>
): Promise<AcceleratedPlaybackResolution> {
    if (!isHttpUrl(url)) {
        return {
            url,
            accelerated: false,
            rangeSupported: false,
            status: 0,
            reason: 'Non-HTTP playback URL',
        };
    }

    try {
        const probe = await requestHeadersOnly(url, {
            method: 'GET',
            headers: {
                ...normalizeHeaders(headers),
                Range: 'bytes=0-0',
                Connection: 'close',
            },
            timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        const contentRange = probe.headers['content-range'];
        const totalMatch =
            typeof contentRange === 'string'
                ? contentRange.match(/\/(\d+|\*)$/)
                : null;
        const totalBytes =
            totalMatch && totalMatch[1] !== '*'
                ? Number(totalMatch[1])
                : undefined;
        const rangeSupported =
            probe.status === 206 && Number.isFinite(totalBytes);
        const redirected = probe.finalUrl !== url;

        return {
            url: redirected ? probe.finalUrl : url,
            accelerated: redirected || rangeSupported,
            rangeSupported,
            status: probe.status,
            reason: rangeSupported
                ? 'Range-supported playback URL resolved'
                : redirected
                  ? 'Direct redirected playback URL resolved'
                  : 'Playback URL is not seekable or has no redirect',
            totalBytes,
        };
    } catch (error) {
        return {
            url,
            accelerated: false,
            rangeSupported: false,
            status: 0,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function benchmarkHttpDownload(
    options: HttpDownloadBenchmarkOptions
): Promise<HttpDownloadBenchmarkResult> {
    const maxBytes = Math.max(
        64 * 1024,
        Math.min(options.maxBytes ?? 8 * 1024 * 1024, 64 * 1024 * 1024)
    );

    if (!isHttpUrl(options.url)) {
        return {
            url: options.url,
            finalUrl: options.url,
            ok: false,
            status: 0,
            rangeRequested: false,
            rangeSupported: false,
            ttfbMs: 0,
            durationMs: 0,
            bytesRead: 0,
            throughputBytesPerSecond: 0,
            samples: [],
            error: 'Only HTTP(S) URLs can be benchmarked',
        };
    }

    try {
        return await requestBenchmarkStream(options.url, {
            method: 'GET',
            headers: {
                ...normalizeHeaders(options.headers),
                Range: `bytes=0-${maxBytes - 1}`,
                Connection: 'close',
            },
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxBytes,
            originalUrl: options.url,
        });
    } catch (error) {
        return {
            url: options.url,
            finalUrl: options.url,
            ok: false,
            status: 0,
            rangeRequested: true,
            rangeSupported: false,
            ttfbMs: 0,
            durationMs: 0,
            bytesRead: 0,
            throughputBytesPerSecond: 0,
            samples: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function probeRangeSupport(
    url: string,
    options: Pick<
        AcceleratedDownloadOptions,
        'headers' | 'timeoutMs' | 'signal'
    >
): Promise<RangeProbeResult> {
    const result = await requestBuffer(url, {
        method: 'GET',
        headers: {
            ...normalizeHeaders(options.headers),
            Range: 'bytes=0-0',
            Connection: 'close',
        },
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
    });

    const contentRange = result.headers['content-range'];
    const totalMatch =
        typeof contentRange === 'string'
            ? contentRange.match(/\/(\d+|\*)$/)
            : null;
    const totalBytes =
        totalMatch && totalMatch[1] !== '*' ? Number(totalMatch[1]) : 0;

    if (
        result.status !== 206 ||
        !Number.isFinite(totalBytes) ||
        totalBytes <= 1
    ) {
        throw new AcceleratedDownloadUnavailableError(
            `Range download is not supported by this URL (HTTP ${result.status})`
        );
    }

    return {
        directUrl: result.finalUrl,
        totalBytes,
        contentType: String(result.headers['content-type'] ?? ''),
    };
}

async function fetchRange(
    url: string,
    chunk: ChunkTask,
    options: Pick<
        AcceleratedDownloadOptions,
        'headers' | 'timeoutMs' | 'signal'
    >
): Promise<RequestResult> {
    return requestBuffer(url, {
        method: 'GET',
        headers: {
            ...normalizeHeaders(options.headers),
            Range: `bytes=${chunk.start}-${chunk.end}`,
            Connection: 'keep-alive',
        },
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
    });
}

function requestBuffer(
    rawUrl: string,
    options: {
        method: string;
        headers: Record<string, string>;
        timeoutMs: number;
        signal?: AbortSignal;
    },
    redirectCount = 0
): Promise<RequestResult> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(rawUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        const chunks: Buffer[] = [];
        let settled = false;

        const req = transport.request(
            {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port,
                path: `${parsed.pathname}${parsed.search}`,
                method: options.method,
                headers: options.headers,
                timeout: options.timeoutMs,
            },
            (res) => {
                const status = res.statusCode ?? 0;
                const location = res.headers.location;
                if (
                    [301, 302, 303, 307, 308].includes(status) &&
                    location &&
                    redirectCount < 5
                ) {
                    res.resume();
                    const nextUrl = new URL(location, rawUrl).toString();
                    requestBuffer(nextUrl, options, redirectCount + 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    if (settled) return;
                    settled = true;
                    resolve({
                        status,
                        headers: res.headers,
                        body: Buffer.concat(chunks),
                        finalUrl: rawUrl,
                    });
                });
                res.on('error', reject);
            }
        );

        const abort = () => {
            if (settled) return;
            settled = true;
            req.destroy();
            reject(new Error('Download canceled'));
        };

        if (options.signal?.aborted) {
            abort();
            return;
        }

        options.signal?.addEventListener('abort', abort, { once: true });

        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });
        req.on('error', (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        });
        req.on('close', () => {
            options.signal?.removeEventListener('abort', abort);
        });
        req.end();
    });
}

function requestBenchmarkStream(
    rawUrl: string,
    options: {
        method: string;
        headers: Record<string, string>;
        timeoutMs: number;
        maxBytes: number;
        originalUrl: string;
    },
    redirectCount = 0
): Promise<HttpDownloadBenchmarkResult> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(rawUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        const startedAt = nowMs();
        const bytesBySecond = new Map<number, number>();
        let settled = false;
        let bytesRead = 0;
        let ttfbMs = 0;

        const req = transport.request(
            {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port,
                path: `${parsed.pathname}${parsed.search}`,
                method: options.method,
                headers: options.headers,
                timeout: options.timeoutMs,
            },
            (res) => {
                const status = res.statusCode ?? 0;
                const location = res.headers.location;
                if (
                    [301, 302, 303, 307, 308].includes(status) &&
                    location &&
                    redirectCount < 5
                ) {
                    res.resume();
                    const nextUrl = new URL(location, rawUrl).toString();
                    requestBenchmarkStream(nextUrl, options, redirectCount + 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                ttfbMs = Math.max(0, nowMs() - startedAt);

                const finish = () => {
                    if (settled) return;
                    settled = true;
                    const durationMs = Math.max(0, nowMs() - startedAt);
                    const downloadMs = Math.max(1, durationMs - ttfbMs);
                    const contentLength = Number(res.headers['content-length']);
                    const totalBytes = parseContentRangeTotal(
                        res.headers['content-range']
                    );
                    const samples = [...bytesBySecond.entries()]
                        .sort((a, b) => a[0] - b[0])
                        .map(([second, bytes]) => ({
                            second,
                            bytes,
                            bytesPerSecond: bytes,
                        }));

                    resolve({
                        url: options.originalUrl,
                        finalUrl: rawUrl,
                        ok: status >= 200 && status < 400,
                        status,
                        rangeRequested: true,
                        rangeSupported: status === 206,
                        ttfbMs: Math.round(ttfbMs),
                        durationMs: Math.round(durationMs),
                        bytesRead,
                        totalBytes,
                        contentLength: Number.isFinite(contentLength)
                            ? contentLength
                            : undefined,
                        contentType:
                            typeof res.headers['content-type'] === 'string'
                                ? res.headers['content-type']
                                : undefined,
                        throughputBytesPerSecond: Math.round(
                            bytesRead / (downloadMs / 1000)
                        ),
                        samples,
                    });
                };

                res.on('data', (chunk: Buffer) => {
                    if (settled) return;
                    const remaining = options.maxBytes - bytesRead;
                    const acceptedBytes = Math.max(
                        0,
                        Math.min(chunk.length, remaining)
                    );

                    if (acceptedBytes > 0) {
                        bytesRead += acceptedBytes;
                        const second = Math.floor(
                            Math.max(0, nowMs() - startedAt - ttfbMs) / 1000
                        );
                        bytesBySecond.set(
                            second,
                            (bytesBySecond.get(second) ?? 0) + acceptedBytes
                        );
                    }

                    if (bytesRead >= options.maxBytes) {
                        finish();
                        res.destroy();
                    }
                });
                res.on('end', finish);
                res.on('error', (error) => {
                    if (settled) return;
                    reject(error);
                });
            }
        );

        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });
        req.on('error', (error) => {
            if (settled) return;
            settled = true;
            reject(error);
        });
        req.end();
    });
}

function requestHeadersOnly(
    rawUrl: string,
    options: {
        method: string;
        headers: Record<string, string>;
        timeoutMs: number;
    },
    redirectCount = 0
): Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    finalUrl: string;
}> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(rawUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        let settled = false;

        const req = transport.request(
            {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port,
                path: `${parsed.pathname}${parsed.search}`,
                method: options.method,
                headers: options.headers,
                timeout: options.timeoutMs,
            },
            (res) => {
                const status = res.statusCode ?? 0;
                const location = res.headers.location;
                if (
                    [301, 302, 303, 307, 308].includes(status) &&
                    location &&
                    redirectCount < 5
                ) {
                    res.resume();
                    const nextUrl = new URL(location, rawUrl).toString();
                    requestHeadersOnly(nextUrl, options, redirectCount + 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                settled = true;
                res.destroy();
                resolve({
                    status,
                    headers: res.headers,
                    finalUrl: rawUrl,
                });
            }
        );

        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });
        req.on('error', (error) => {
            if (settled) return;
            reject(error);
        });
        req.end();
    });
}

function parseContentRangeTotal(value: unknown): number | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const match = value.match(/\/(\d+|\*)$/);
    if (!match || match[1] === '*') {
        return undefined;
    }

    const total = Number(match[1]);
    return Number.isFinite(total) ? total : undefined;
}

function buildChunks(totalBytes: number, chunkBytes: number): ChunkTask[] {
    const chunks: ChunkTask[] = [];
    for (let start = 0; start < totalBytes; start += chunkBytes) {
        chunks.push({
            index: chunks.length,
            start,
            end: Math.min(start + chunkBytes - 1, totalBytes - 1),
        });
    }
    return chunks;
}

function normalizeHeaders(
    headers?: Record<string, string>
): Record<string, string> {
    const normalized: Record<string, string> = {};
    Object.entries(headers ?? {}).forEach(([name, value]) => {
        if (!name || value === undefined || value === null) return;
        const trimmed = String(value).trim();
        if (!trimmed) return;
        normalized[name] = trimmed;
    });
    return normalized;
}

function isHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs(): number {
    return Number(process.hrtime.bigint()) / 1_000_000;
}
