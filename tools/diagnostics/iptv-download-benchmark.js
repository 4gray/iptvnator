#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');
const { performance } = require('perf_hooks');

for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error) => {
        if (error && error.code === 'EPIPE') {
            return;
        }
        throw error;
    });
}

const MB = 1024 * 1024;
const SOCKET_ERROR_HANDLER = Symbol('iptvBenchmarkSocketErrorHandler');
const DEFAULTS = {
    query: 'harry potter',
    quality: '2160|uhd|4k',
    strategies: 'single,keepalive-off,range,reconnect,parallel-range',
    maxSeconds: 120,
    maxMB: 1024,
    chunkMB: 64,
    reconnectMB: 128,
    parallel: 2,
    readBufferKB: 64,
    retries: 2,
    backoffMs: 1000,
    timeoutMs: 30000,
    apiTimeoutMs: 120000,
    streamId: 0,
    extension: 'mkv',
    dropWarmupSeconds: 10,
    dropWindowSeconds: 5,
    dropRatio: 0.5,
    userAgent: 'IPTVnator diagnostics benchmark/1.0',
};

function repoRoot() {
    return path.resolve(__dirname, '..', '..');
}

function toCamel(key) {
    return key.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function parseArgs(argv) {
    const opts = { ...DEFAULTS };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            continue;
        }

        const raw = arg.slice(2);
        const eq = raw.indexOf('=');
        let key = raw;
        let value = 'true';
        if (eq >= 0) {
            key = raw.slice(0, eq);
            value = raw.slice(eq + 1);
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
            value = argv[i + 1];
            i += 1;
        }

        opts[toCamel(key)] = value;
    }

    const aliases = {
        maxMb: 'maxMB',
        chunkMb: 'chunkMB',
        reconnectMb: 'reconnectMB',
        readBufferKb: 'readBufferKB',
    };
    for (const [from, to] of Object.entries(aliases)) {
        if (opts[from] !== undefined) {
            opts[to] = opts[from];
        }
    }

    for (const key of [
        'maxSeconds',
        'maxMB',
        'chunkMB',
        'reconnectMB',
        'parallel',
        'readBufferKB',
        'retries',
        'backoffMs',
        'timeoutMs',
        'apiTimeoutMs',
        'dropWarmupSeconds',
        'dropWindowSeconds',
    ]) {
        opts[key] = Number(opts[key]);
    }
    opts.dropRatio = Number(opts.dropRatio);
    opts.keepAlive = parseBoolean(opts.keepAlive, true);
    opts.help = parseBoolean(opts.help, false);
    opts.includeTitle = parseBoolean(opts.includeTitle, true);
    opts.useDirectRedirect = parseBoolean(opts.useDirectRedirect, false);
    return opts;
}

function parseBoolean(value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    const normalized = String(value).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function printHelp() {
    console.log(`IPTV VOD download benchmark

Usage:
  node tools/diagnostics/iptv-download-benchmark.js [options]

Options:
  --query "harry potter"       VOD title search terms
  --quality "2160|uhd|4k"      Regex applied to title/metadata
  --strategies list            single,keepalive-off,range,reconnect,parallel-range
  --max-seconds 120            Per-strategy wall-clock cap
  --max-mb 1024                Per-strategy download cap, payload is discarded
  --chunk-mb 64                Range chunk size
  --reconnect-mb 128           Reconnect before this useful byte threshold
  --parallel 2                 Parallel range worker count
  --read-buffer-kb 64          Node HTTP read buffer hint
  --timeout-ms 30000           Per-request idle timeout
  --retries 2                  Retries for transient failures
  --secrets path               Defaults to .secrets/iptv.local.json
  --out-dir path               Defaults to .tmp/iptv-bench-<timestamp>
  --include-title false        Do not write selected VOD title in reports
  --stream-id 112763           Skip catalog lookup and benchmark this VOD id
  --extension mkv              Extension to use with --stream-id
  --use-direct-redirect true   Benchmark the first redirected CDN URL directly
`);
}

function readCredentials(root, secretsArg) {
    const secretsPath = path.resolve(
        root,
        secretsArg || path.join('.secrets', 'iptv.local.json')
    );
    const raw = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    const candidates = [raw.xtream, raw.iptv, raw.account, raw].filter(Boolean);
    const account = candidates.find((candidate) => {
        return (
            (candidate.serverUrl || candidate.url || candidate.Url) &&
            (candidate.username || candidate.Username) &&
            (candidate.password || candidate.Password)
        );
    });

    if (!account) {
        throw new Error(`No Xtream account found in ${secretsPath}`);
    }

    return {
        serverUrl: String(account.serverUrl || account.url || account.Url).replace(
            /\/+$/,
            ''
        ),
        username: String(account.username || account.Username),
        password: String(account.password || account.Password),
        name: account.name || account.title || 'IPTV account',
    };
}

function redactUrl(rawUrl, credentials) {
    let redacted = String(rawUrl);
    const replacements = [
        credentials.username,
        credentials.password,
        encodeURIComponent(credentials.username),
        encodeURIComponent(credentials.password),
    ];

    for (const value of replacements) {
        if (!value) {
            continue;
        }
        redacted = redacted.split(value).join('[redacted]');
    }

    try {
        const parsed = new URL(redacted);
        parsed.pathname = parsed.pathname.replace(
            /\/live\/play\/[^/]+/i,
            '/live/play/[redacted]'
        );
        if (parsed.searchParams.has('username')) {
            parsed.searchParams.set('username', '[redacted]');
        }
        if (parsed.searchParams.has('password')) {
            parsed.searchParams.set('password', '[redacted]');
        }
        return parsed.toString();
    } catch {
        return redacted;
    }
}

function buildApiUrl(credentials, action, extra = {}) {
    const params = new URLSearchParams({
        username: credentials.username,
        password: credentials.password,
        action,
        ...extra,
    });
    return `${credentials.serverUrl}/player_api.php?${params.toString()}`;
}

function buildVodUrl(credentials, item) {
    const streamId = Number(item.stream_id || item.xtream_id || item.id);
    const extension =
        item.container_extension ||
        item.stream_format ||
        item.extension ||
        'mp4';
    if (!Number.isFinite(streamId) || streamId <= 0) {
        throw new Error('Selected VOD item has no stream_id');
    }
    return `${credentials.serverUrl}/movie/${encodeURIComponent(
        credentials.username
    )}/${encodeURIComponent(credentials.password)}/${streamId}.${extension}`;
}

function buildVodUrlFromId(credentials, streamId, extension) {
    return `${credentials.serverUrl}/movie/${encodeURIComponent(
        credentials.username
    )}/${encodeURIComponent(credentials.password)}/${Number(streamId)}.${
        extension || 'mp4'
    }`;
}

function createAgentForUrl(rawUrl, keepAlive, maxSockets) {
    const parsed = new URL(rawUrl);
    const Agent = parsed.protocol === 'https:' ? https.Agent : http.Agent;
    return new Agent({
        keepAlive,
        maxSockets: Math.max(1, maxSockets || 1),
    });
}

function transportForUrl(rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') {
        return https;
    }
    if (parsed.protocol === 'http:') {
        return http;
    }
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseHeaders(headers) {
    const wanted = [
        'accept-ranges',
        'cache-control',
        'connection',
        'content-length',
        'content-range',
        'content-type',
        'date',
        'etag',
        'last-modified',
        'location',
        'server',
        'transfer-encoding',
        'vary',
    ];
    const output = {};
    for (const key of wanted) {
        if (headers[key] !== undefined) {
            output[key] = headers[key];
        }
    }
    return output;
}

function isRedirect(status) {
    return [301, 302, 303, 307, 308].includes(Number(status));
}

function statusRetryable(status) {
    return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

class SampleRecorder {
    constructor(strategy) {
        this.strategy = strategy;
        this.startedAt = performance.now();
        this.totalBytes = 0;
        this.currentBytes = 0;
        this.second = 0;
        this.activeConnections = 0;
        this.samples = [];
        this.timer = setInterval(() => this.tick(false), 1000);
    }

    addBytes(bytes) {
        this.totalBytes += bytes;
        this.currentBytes += bytes;
    }

    openConnection() {
        this.activeConnections += 1;
    }

    closeConnection() {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
    }

    tick(force) {
        if (!force && this.currentBytes === 0 && this.totalBytes === 0) {
            this.second += 1;
            return;
        }
        const elapsedMs = performance.now() - this.startedAt;
        const mbps = (this.currentBytes * 8) / 1000000;
        this.samples.push({
            strategy: this.strategy,
            second: this.second + 1,
            elapsedMs: Math.round(elapsedMs),
            totalBytes: this.totalBytes,
            bytesThisSecond: this.currentBytes,
            mbps: Number(mbps.toFixed(3)),
            activeConnections: this.activeConnections,
        });
        this.currentBytes = 0;
        this.second += 1;
    }

    stop() {
        clearInterval(this.timer);
        if (this.currentBytes > 0 || this.samples.length === 0) {
            this.tick(true);
        }
        return this.samples;
    }
}

function measuredRequestOnce(rawUrl, config, redirectCount = 0, overallStart = null) {
    return new Promise((resolve) => {
        const start = overallStart || performance.now();
        const attemptStart = performance.now();
        const parsed = new URL(rawUrl);
        const transport = transportForUrl(rawUrl);
        const headers = { ...(config.headers || {}) };
        let bytes = 0;
        let settled = false;
        let controlledStop = false;
        let timeout = false;
        let status = null;
        let httpVersion = null;
        let ttfbMs = null;
        let finalHeaders = {};
        let remoteAddress = null;
        let remotePort = null;
        const startedAtIso = new Date().toISOString();

        const requestOptions = {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port,
            path: `${parsed.pathname}${parsed.search}`,
            method: config.method || 'GET',
            headers,
            agent: config.agent,
            highWaterMark: config.readBufferKB
                ? Number(config.readBufferKB) * 1024
                : undefined,
        };

        if (config.sample) {
            config.sample.openConnection();
        }

        const finish = (errorMessage) => {
            if (settled) {
                return;
            }
            settled = true;
            if (config.wallTimer) {
                clearTimeout(config.wallTimer);
            }
            if (config.sample) {
                config.sample.closeConnection();
            }
            const endedAtIso = new Date().toISOString();
            resolve({
                strategy: config.strategy,
                connectionIndex: config.connectionIndex,
                segmentIndex: config.segmentIndex,
                attempt: config.attempt,
                method: requestOptions.method,
                url: config.redactUrl ? config.redactUrl(rawUrl) : rawUrl,
                rangeStart: config.rangeStart,
                rangeEnd: config.rangeEnd,
                status,
                httpVersion,
                ttfbMs: ttfbMs === null ? null : Math.round(ttfbMs),
                durationMs: Math.round(performance.now() - attemptStart),
                bytes,
                error: errorMessage || null,
                controlledStop,
                timeout,
                redirects: redirectCount,
                headers: finalHeaders,
                remoteAddress,
                remotePort,
                startedAt: startedAtIso,
                endedAt: endedAtIso,
            });
        };

        let req;
        try {
            req = transport.request(requestOptions, (res) => {
                status = res.statusCode || 0;
                httpVersion = res.httpVersion;
                ttfbMs = performance.now() - start;
                finalHeaders = responseHeaders(res.headers);
                remoteAddress = res.socket?.remoteAddress || null;
                remotePort = res.socket?.remotePort || null;

                if (
                    isRedirect(status) &&
                    res.headers.location &&
                    redirectCount < 5
                ) {
                    const nextUrl = new URL(res.headers.location, rawUrl).toString();
                    res.resume();
                    res.on('end', async () => {
                        if (config.sample) {
                            config.sample.closeConnection();
                        }
                        const redirected = await measuredRequestOnce(
                            nextUrl,
                            config,
                            redirectCount + 1,
                            start
                        );
                        resolve(redirected);
                    });
                    return;
                }

                res.on('data', (chunk) => {
                    bytes += chunk.length;
                    if (config.sample) {
                        config.sample.addBytes(chunk.length);
                    }
                    if (config.onData) {
                        config.onData(chunk);
                    }
                    if (config.maxBytes && bytes >= config.maxBytes) {
                        controlledStop = true;
                        req.destroy(new Error('BENCHMARK_LIMIT'));
                    }
                });
                res.on('error', (error) => {
                    if (controlledStop) {
                        finish(null);
                    } else {
                        finish(error instanceof Error ? error.message : String(error));
                    }
                });
                res.on('end', () => finish(null));
            });
        } catch (error) {
            finish(error instanceof Error ? error.message : String(error));
            return;
        }

        req.on('socket', (socket) => {
            if (!socket[SOCKET_ERROR_HANDLER]) {
                socket[SOCKET_ERROR_HANDLER] = true;
                socket.on('error', () => {
                    // req/res handlers record the request-level error. This
                    // listener prevents intentional benchmark aborts from
                    // surfacing as unhandled socket errors on reused sockets.
                });
            }
            remoteAddress = socket.remoteAddress || remoteAddress;
            remotePort = socket.remotePort || remotePort;
        });

        req.on('timeout', () => {
            timeout = true;
            req.destroy(new Error('REQUEST_TIMEOUT'));
        });

        req.on('error', (error) => {
            if (controlledStop) {
                finish(null);
            } else {
                finish(error instanceof Error ? error.message : String(error));
            }
        });

        req.setTimeout(config.timeoutMs);

        if (config.maxSeconds && config.maxSeconds > 0) {
            config.wallTimer = setTimeout(() => {
                controlledStop = true;
                req.destroy(new Error('BENCHMARK_TIME_LIMIT'));
            }, config.maxSeconds * 1000);
        }

        req.end();
    });
}

async function measuredRequest(rawUrl, config) {
    const records = [];
    const retries = Math.max(0, Number(config.retries || 0));
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        const record = await measuredRequestOnce(rawUrl, {
            ...config,
            attempt,
        });
        records.push(record);

        const retryable =
            !record.controlledStop &&
            (record.error || statusRetryable(record.status));
        if (!retryable || attempt > retries) {
            return { record, records };
        }

        await sleep(Number(config.backoffMs || 1000) * attempt);
    }

    return { record: records[records.length - 1], records };
}

async function collectText(rawUrl, options) {
    const chunks = [];
    let collected = 0;
    const result = await measuredRequest(rawUrl, {
        strategy: 'collect',
        connectionIndex: 0,
        method: options.method || 'GET',
        headers: options.headers || {},
        agent: options.agent,
        timeoutMs: options.timeoutMs || DEFAULTS.apiTimeoutMs,
        retries: options.retries ?? 1,
        backoffMs: options.backoffMs || 1000,
        maxBytes: options.maxBytes || 256 * MB,
        redactUrl: options.redactUrl,
        onData: (chunk) => {
            collected += chunk.length;
            if (collected <= (options.maxBytes || 256 * MB)) {
                chunks.push(chunk);
            }
        },
    });

    const record = result.record;
    if (record.error && !record.controlledStop) {
        throw new Error(`Request failed: ${record.error}`);
    }
    if (record.status < 200 || record.status >= 400) {
        throw new Error(`Request returned HTTP ${record.status}`);
    }
    return {
        status: record.status,
        headers: record.headers,
        text: Buffer.concat(chunks).toString('utf8'),
        record,
    };
}

async function fetchJson(rawUrl, options) {
    const response = await collectText(rawUrl, options);
    try {
        return JSON.parse(response.text);
    } catch (error) {
        const prefix = response.text.slice(0, 160).replace(/\s+/g, ' ');
        throw new Error(`Invalid JSON response: ${prefix}`);
    }
}

function searchableText(item) {
    return [
        item.name,
        item.title,
        item.stream_id,
        item.container_extension,
        item.category_name,
        item.added,
        item.year,
    ]
        .filter((part) => part !== undefined && part !== null)
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function selectVod(streams, opts) {
    const terms = String(opts.query || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const qualityRegex = opts.quality ? new RegExp(opts.quality, 'i') : null;
    const withText = streams.map((item) => ({
        item,
        text: searchableText(item),
        title: String(item.name || item.title || ''),
    }));
    const queryMatches =
        terms.length === 0
            ? withText
            : withText.filter((entry) =>
                  terms.every((term) => entry.text.includes(term))
              );
    const qualityMatches = qualityRegex
        ? queryMatches.filter((entry) => qualityRegex.test(entry.text))
        : queryMatches;

    let selected = qualityMatches[0] || queryMatches[0];
    let reason = qualityMatches[0]
        ? 'query and quality'
        : queryMatches[0]
          ? 'query fallback without requested quality marker'
          : '';

    if (!selected && qualityRegex) {
        selected = withText.find((entry) => qualityRegex.test(entry.text));
        reason = selected ? 'quality fallback without query match' : '';
    }
    if (!selected) {
        selected = withText[0];
        reason = 'first VOD fallback';
    }

    if (!selected) {
        return null;
    }

    return {
        item: selected.item,
        title: selected.title,
        reason,
        counts: {
            totalVod: streams.length,
            queryMatches: queryMatches.length,
            queryAndQualityMatches: qualityMatches.length,
        },
    };
}

async function enrichVodInfo(credentials, item, opts, redact) {
    const streamId = Number(item.stream_id || item.xtream_id || item.id);
    if (!Number.isFinite(streamId) || streamId <= 0) {
        return item;
    }
    if (item.container_extension) {
        return item;
    }

    const url = buildApiUrl(credentials, 'get_vod_info', {
        vod_id: String(streamId),
    });
    try {
        const info = await fetchJson(url, {
            timeoutMs: opts.apiTimeoutMs,
            retries: 1,
            redactUrl: redact,
        });
        return {
            ...item,
            ...(info.movie_data || {}),
            name: item.name || info.info?.name || info.movie_data?.name,
            container_extension:
                item.container_extension ||
                info.movie_data?.container_extension ||
                info.info?.container_extension,
        };
    } catch {
        return item;
    }
}

async function probeHead(rawUrl, opts, agent, redact) {
    const result = await measuredRequest(rawUrl, {
        strategy: 'probe-head',
        connectionIndex: 0,
        method: 'HEAD',
        headers: {
            'User-Agent': opts.userAgent,
        },
        agent,
        timeoutMs: opts.timeoutMs,
        readBufferKB: opts.readBufferKB,
        retries: 0,
        backoffMs: opts.backoffMs,
        redactUrl: redact,
    });
    return result.record;
}

async function probeRange(rawUrl, opts, agent, redact) {
    const result = await measuredRequest(rawUrl, {
        strategy: 'probe-range',
        connectionIndex: 0,
        method: 'GET',
        headers: {
            'User-Agent': opts.userAgent,
            Range: 'bytes=0-0',
        },
        agent,
        timeoutMs: opts.timeoutMs,
        readBufferKB: opts.readBufferKB,
        retries: 0,
        backoffMs: opts.backoffMs,
        maxBytes: 1,
        rangeStart: 0,
        rangeEnd: 0,
        redactUrl: redact,
    });
    const record = result.record;
    const contentRange = record.headers?.['content-range'];
    const totalMatch =
        typeof contentRange === 'string'
            ? contentRange.match(/\/(\d+|\*)$/)
            : null;
    return {
        record,
        supported: record.status === 206 && !!contentRange,
        totalBytes:
            totalMatch && totalMatch[1] !== '*'
                ? Number(totalMatch[1])
                : Number(record.headers?.['content-length']) || null,
    };
}

async function resolveDirectRedirect(rawUrl, opts, redact) {
    return new Promise((resolve) => {
        const parsed = new URL(rawUrl);
        const transport = transportForUrl(rawUrl);
        const req = transport.request(
            {
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port,
                path: `${parsed.pathname}${parsed.search}`,
                method: 'GET',
                headers: {
                    'User-Agent': opts.userAgent,
                    Range: 'bytes=0-0',
                    Connection: 'close',
                },
                timeout: opts.timeoutMs,
            },
            (res) => {
                const location = res.headers.location
                    ? new URL(res.headers.location, rawUrl).toString()
                    : null;
                res.resume();
                resolve({
                    status: res.statusCode || 0,
                    location,
                    redactedLocation: location ? redact(location) : null,
                });
            }
        );
        req.on('timeout', () => {
            req.destroy(new Error('REQUEST_TIMEOUT'));
        });
        req.on('error', (error) => {
            resolve({
                status: 0,
                location: null,
                redactedLocation: null,
                error: error instanceof Error ? error.message : String(error),
            });
        });
        req.end();
    });
}

function computeDrop(samples, opts) {
    const usable = samples.filter((sample) => sample.bytesThisSecond > 0);
    if (usable.length < opts.dropWarmupSeconds + opts.dropWindowSeconds) {
        return null;
    }

    const warmup = usable.filter(
        (sample) =>
            sample.second >= 2 && sample.second <= opts.dropWarmupSeconds + 1
    );
    if (warmup.length === 0) {
        return null;
    }

    const sorted = warmup.map((sample) => sample.mbps).sort((a, b) => a - b);
    const baselineMbps = sorted[Math.floor(sorted.length / 2)];
    const threshold = baselineMbps * opts.dropRatio;

    for (let i = 0; i <= usable.length - opts.dropWindowSeconds; i += 1) {
        const window = usable.slice(i, i + opts.dropWindowSeconds);
        const first = window[0];
        if (first.second <= opts.dropWarmupSeconds) {
            continue;
        }
        const avg =
            window.reduce((sum, sample) => sum + sample.mbps, 0) /
            window.length;
        if (avg < threshold) {
            return {
                second: first.second,
                elapsedMs: first.elapsedMs,
                totalBytes: first.totalBytes,
                mbAtDrop: Number((first.totalBytes / MB).toFixed(2)),
                windowSeconds: opts.dropWindowSeconds,
                windowAvgMbps: Number(avg.toFixed(3)),
                baselineMbps: Number(baselineMbps.toFixed(3)),
                thresholdMbps: Number(threshold.toFixed(3)),
                dropRatio: opts.dropRatio,
            };
        }
    }

    return null;
}

function summarizeStrategy(strategy, records, samples, opts) {
    const started = records
        .map((record) => new Date(record.startedAt).getTime())
        .filter(Number.isFinite);
    const ended = records
        .map((record) => new Date(record.endedAt).getTime())
        .filter(Number.isFinite);
    const durationMs =
        started.length && ended.length
            ? Math.max(...ended) - Math.min(...started)
            : samples.at(-1)?.elapsedMs || 0;
    const totalBytes = samples.at(-1)?.totalBytes || 0;
    const avgMbps =
        durationMs > 0 ? (totalBytes * 8) / (durationMs / 1000) / 1000000 : 0;
    const successful = records.filter(
        (record) =>
            !record.error &&
            record.status &&
            record.status >= 200 &&
            record.status < 400
    );
    const failed = records.filter((record) => record.error);
    const ttfbValues = records
        .map((record) => record.ttfbMs)
        .filter((value) => value !== null)
        .sort((a, b) => a - b);
    const p50Ttfb = ttfbValues.length
        ? ttfbValues[Math.floor(ttfbValues.length / 2)]
        : null;
    const rangeCoverage = computeRangeCoverage(records);
    const usefulAverageMbps =
        rangeCoverage && durationMs > 0
            ? (rangeCoverage.usefulBytes * 8) /
              (durationMs / 1000) /
              1000000
            : null;

    return {
        strategy,
        totalBytes,
        totalMB: Number((totalBytes / MB).toFixed(2)),
        durationMs,
        averageMbps: Number(avgMbps.toFixed(3)),
        maxOneSecondMbps: samples.length
            ? Math.max(...samples.map((sample) => sample.mbps))
            : 0,
        p50TtfbMs: p50Ttfb,
        connections: records.length,
        successfulConnections: successful.length,
        failedConnections: failed.length,
        usefulAverageMbps:
            usefulAverageMbps === null
                ? null
                : Number(usefulAverageMbps.toFixed(3)),
        retries:
            records.filter((record) => Number(record.attempt || 1) > 1).length,
        statuses: Array.from(
            new Set(records.map((record) => record.status).filter(Boolean))
        ),
        rangeCoverage,
        drop: computeDrop(samples, opts),
    };
}

function computeRangeCoverage(records) {
    const ranged = records.filter(
        (record) =>
            record.rangeStart !== undefined &&
            record.rangeStart !== null &&
            record.rangeEnd !== undefined &&
            record.rangeEnd !== null
    );
    if (ranged.length === 0) {
        return null;
    }

    const completed = [];
    let incompleteChunks = 0;
    for (const record of ranged) {
        const start = Number(record.rangeStart);
        const end = Number(record.rangeEnd);
        const expectedBytes = end - start + 1;
        if (
            record.status === 206 &&
            !record.error &&
            Number(record.bytes) >= expectedBytes
        ) {
            completed.push([start, end]);
        } else {
            incompleteChunks += 1;
        }
    }

    completed.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of completed) {
        const last = merged[merged.length - 1];
        if (!last || range[0] > last[1] + 1) {
            merged.push([...range]);
        } else {
            last[1] = Math.max(last[1], range[1]);
        }
    }

    const usefulBytes = merged.reduce(
        (sum, range) => sum + range[1] - range[0] + 1,
        0
    );
    return {
        completedChunks: completed.length,
        incompleteChunks,
        mergedRanges: merged.length,
        usefulBytes,
        usefulMB: Number((usefulBytes / MB).toFixed(2)),
        firstGapStart: firstGapStart(merged),
    };
}

function firstGapStart(merged) {
    if (merged.length === 0) {
        return 0;
    }
    let nextExpected = 0;
    for (const range of merged) {
        if (range[0] > nextExpected) {
            return nextExpected;
        }
        nextExpected = range[1] + 1;
    }
    return null;
}

async function runSingle(rawUrl, credentials, opts, keepAlive, name) {
    const sample = new SampleRecorder(name);
    const agent = createAgentForUrl(rawUrl, keepAlive, 1);
    const redact = (url) => redactUrl(url, credentials);
    const result = await measuredRequest(rawUrl, {
        strategy: name,
        connectionIndex: 1,
        method: 'GET',
        headers: {
            'User-Agent': opts.userAgent,
            Connection: keepAlive ? 'keep-alive' : 'close',
        },
        agent,
        sample,
        timeoutMs: opts.timeoutMs,
        readBufferKB: opts.readBufferKB,
        retries: opts.retries,
        backoffMs: opts.backoffMs,
        maxBytes: opts.maxMB * MB,
        maxSeconds: opts.maxSeconds,
        redactUrl: redact,
    });
    const samples = sample.stop();
    agent.destroy();
    return {
        summary: summarizeStrategy(name, result.records, samples, opts),
        records: result.records,
        samples,
    };
}

async function runRangeSequential(rawUrl, credentials, opts, rangeProbe, name, chunkMB) {
    const sample = new SampleRecorder(name);
    const agent = createAgentForUrl(rawUrl, true, 1);
    const redact = (url) => redactUrl(url, credentials);
    const records = [];
    const chunkBytes = Math.max(1, chunkMB) * MB;
    const targetBytes = Math.min(
        opts.maxMB * MB,
        rangeProbe.totalBytes || opts.maxMB * MB
    );
    const startTime = performance.now();
    let offset = 0;
    let connectionIndex = 1;

    while (offset < targetBytes) {
        const elapsedSeconds = (performance.now() - startTime) / 1000;
        if (elapsedSeconds >= opts.maxSeconds) {
            break;
        }

        const rangeStart = offset;
        const rangeEnd = Math.min(offset + chunkBytes - 1, targetBytes - 1);
        const result = await measuredRequest(rawUrl, {
            strategy: name,
            connectionIndex,
            segmentIndex: connectionIndex,
            method: 'GET',
            headers: {
                'User-Agent': opts.userAgent,
                Range: `bytes=${rangeStart}-${rangeEnd}`,
                Connection: 'keep-alive',
            },
            agent,
            sample,
            timeoutMs: opts.timeoutMs,
            readBufferKB: opts.readBufferKB,
            retries: opts.retries,
            backoffMs: opts.backoffMs,
            rangeStart,
            rangeEnd,
            maxSeconds: Math.max(1, opts.maxSeconds - elapsedSeconds),
            redactUrl: redact,
        });
        records.push(...result.records);
        const record = result.record;
        if (record.status !== 206 || record.error) {
            break;
        }
        offset = rangeEnd + 1;
        connectionIndex += 1;
    }

    const samples = sample.stop();
    agent.destroy();
    return {
        summary: summarizeStrategy(name, records, samples, opts),
        records,
        samples,
    };
}

async function runParallelRange(rawUrl, credentials, opts, rangeProbe) {
    const name = 'parallel-range';
    const sample = new SampleRecorder(name);
    const agent = createAgentForUrl(rawUrl, true, opts.parallel);
    const redact = (url) => redactUrl(url, credentials);
    const records = [];
    const chunkBytes = Math.max(1, opts.chunkMB) * MB;
    const targetBytes = Math.min(
        opts.maxMB * MB,
        rangeProbe.totalBytes || opts.maxMB * MB
    );
    const chunks = [];
    for (let start = 0; start < targetBytes; start += chunkBytes) {
        chunks.push({
            start,
            end: Math.min(start + chunkBytes - 1, targetBytes - 1),
            index: chunks.length + 1,
        });
    }

    const startTime = performance.now();
    let next = 0;
    async function worker() {
        while (next < chunks.length) {
            const chunk = chunks[next];
            next += 1;
            const elapsedSeconds = (performance.now() - startTime) / 1000;
            if (elapsedSeconds >= opts.maxSeconds) {
                return;
            }

            const result = await measuredRequest(rawUrl, {
                strategy: name,
                connectionIndex: chunk.index,
                segmentIndex: chunk.index,
                method: 'GET',
                headers: {
                    'User-Agent': opts.userAgent,
                    Range: `bytes=${chunk.start}-${chunk.end}`,
                    Connection: 'keep-alive',
                },
                agent,
                sample,
                timeoutMs: opts.timeoutMs,
                readBufferKB: opts.readBufferKB,
                retries: opts.retries,
                backoffMs: opts.backoffMs,
                rangeStart: chunk.start,
                rangeEnd: chunk.end,
                maxSeconds: Math.max(1, opts.maxSeconds - elapsedSeconds),
                redactUrl: redact,
            });
            records.push(...result.records);
        }
    }

    const workers = [];
    for (let i = 0; i < Math.max(1, opts.parallel); i += 1) {
        workers.push(worker());
    }
    await Promise.all(workers);
    const samples = sample.stop();
    agent.destroy();
    return {
        summary: summarizeStrategy(name, records, samples, opts),
        records,
        samples,
    };
}

function csvEscape(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const text =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function writeCsv(filePath, rows, columns) {
    const lines = [columns.join(',')];
    for (const row of rows) {
        lines.push(columns.map((column) => csvEscape(row[column])).join(','));
    }
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function ensureOutDir(root, opts) {
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .replace('Z', '');
    const outDir = path.resolve(
        root,
        opts.outDir || path.join('.tmp', `iptv-bench-${timestamp}`)
    );
    fs.mkdirSync(outDir, { recursive: true });
    return outDir;
}

function detectHttp2(rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') {
        return {
            supported: false,
            reason: 'VOD URL uses plain HTTP; this benchmark does not attempt h2c upgrade.',
        };
    }
    return {
        supported: 'unknown',
        reason: 'HTTPS URL; use a dedicated h2 probe before enabling HTTP/2 download mode.',
    };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        printHelp();
        return;
    }

    const root = repoRoot();
    const credentials = readCredentials(root, opts.secrets);
    const redact = (url) => redactUrl(url, credentials);
    const outDir = ensureOutDir(root, opts);
    const strategyNames = String(opts.strategies)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);

    console.log(`[bench] output=${outDir}`);
    let selection;
    let vodUrl;
    let streamId;
    let extension;
    if (Number(opts.streamId) > 0) {
        streamId = Number(opts.streamId);
        extension = String(opts.extension || 'mp4');
        vodUrl = buildVodUrlFromId(credentials, streamId, extension);
        selection = {
            title: '[direct stream id]',
            reason: 'direct stream id',
            counts: {
                totalVod: null,
                queryMatches: null,
                queryAndQualityMatches: null,
            },
        };
        console.log(`[bench] selected stream_id=${streamId} ext=${extension} reason="direct stream id"`);
    } else {
        console.log(`[bench] loading VOD catalog for query="${opts.query}"`);

        const catalogUrl = buildApiUrl(credentials, 'get_vod_streams');
        const streams = await fetchJson(catalogUrl, {
            timeoutMs: opts.apiTimeoutMs,
            retries: 1,
            redactUrl: redact,
        });
        if (!Array.isArray(streams) || streams.length === 0) {
            throw new Error('VOD catalog is empty or unavailable.');
        }

        selection = selectVod(streams, opts);
        if (!selection) {
            throw new Error('No VOD item could be selected.');
        }
        const selectedItem = await enrichVodInfo(
            credentials,
            selection.item,
            opts,
            redact
        );
        vodUrl = buildVodUrl(credentials, selectedItem);
        streamId = Number(
            selectedItem.stream_id || selectedItem.xtream_id || selectedItem.id
        );
        extension =
            selectedItem.container_extension ||
            selectedItem.stream_format ||
            selectedItem.extension ||
            'mp4';

        console.log(
            `[bench] selected stream_id=${streamId} ext=${extension} reason="${selection.reason}"`
        );
        console.log(
            `[bench] matches query=${selection.counts.queryMatches} query+quality=${selection.counts.queryAndQualityMatches} total=${selection.counts.totalVod}`
        );
    }

    let directRedirect = null;
    if (opts.useDirectRedirect) {
        directRedirect = await resolveDirectRedirect(vodUrl, opts, redact);
        if (directRedirect.location) {
            vodUrl = directRedirect.location;
            console.log(`[bench] using direct redirect URL ${directRedirect.redactedLocation}`);
        } else {
            console.log('[bench] direct redirect requested but no redirect was returned');
        }
    }

    const probeAgent = createAgentForUrl(vodUrl, false, 1);
    const head = await probeHead(vodUrl, opts, probeAgent, redact);
    const range = await probeRange(vodUrl, opts, probeAgent, redact);
    probeAgent.destroy();

    console.log(
        `[bench] probe head=${head.status || 'n/a'} range=${
            range.supported ? 'yes' : 'no'
        } total=${range.totalBytes || 'unknown'}`
    );

    const strategyResults = [];
    const skipped = [];
    for (const strategy of strategyNames) {
        if (strategy === 'single') {
            console.log('[bench] running single keep-alive strategy');
            strategyResults.push(
                await runSingle(vodUrl, credentials, opts, true, 'single')
            );
            continue;
        }
        if (strategy === 'keepalive-off') {
            console.log('[bench] running single no-keep-alive strategy');
            strategyResults.push(
                await runSingle(
                    vodUrl,
                    credentials,
                    opts,
                    false,
                    'keepalive-off'
                )
            );
            continue;
        }
        if (strategy === 'range') {
            if (!range.supported) {
                skipped.push({
                    strategy,
                    reason: 'server did not return HTTP 206 to Range probe',
                });
                continue;
            }
            console.log('[bench] running sequential range strategy');
            strategyResults.push(
                await runRangeSequential(
                    vodUrl,
                    credentials,
                    opts,
                    range,
                    'range',
                    opts.chunkMB
                )
            );
            continue;
        }
        if (strategy === 'reconnect') {
            if (!range.supported) {
                skipped.push({
                    strategy,
                    reason: 'server did not return HTTP 206 to Range probe',
                });
                continue;
            }
            console.log('[bench] running controlled reconnect strategy');
            strategyResults.push(
                await runRangeSequential(
                    vodUrl,
                    credentials,
                    opts,
                    range,
                    'reconnect',
                    opts.reconnectMB
                )
            );
            continue;
        }
        if (strategy === 'parallel-range') {
            if (!range.supported) {
                skipped.push({
                    strategy,
                    reason: 'server did not return HTTP 206 to Range probe',
                });
                continue;
            }
            console.log('[bench] running parallel range strategy');
            strategyResults.push(
                await runParallelRange(vodUrl, credentials, opts, range)
            );
            continue;
        }
        skipped.push({ strategy, reason: 'unknown strategy' });
    }

    const allSamples = strategyResults.flatMap((result) => result.samples);
    const allRecords = strategyResults.flatMap((result) => result.records);
    const summary = {
        createdAt: new Date().toISOString(),
        accountName: credentials.name,
        selectedVod: {
            streamId,
            title: opts.includeTitle ? selection.title : '[redacted]',
            containerExtension: extension,
            selectionReason: selection.reason,
            matchCounts: selection.counts,
        },
        vodUrl: redact(vodUrl),
        directRedirect,
        limits: {
            maxSeconds: opts.maxSeconds,
            maxMB: opts.maxMB,
            chunkMB: opts.chunkMB,
            reconnectMB: opts.reconnectMB,
            parallel: opts.parallel,
            readBufferKB: opts.readBufferKB,
            retries: opts.retries,
            timeoutMs: opts.timeoutMs,
        },
        probes: {
            head,
            range,
            http2: detectHttp2(vodUrl),
        },
        strategies: strategyResults.map((result) => result.summary),
        skipped,
    };

    fs.writeFileSync(
        path.join(outDir, 'summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8'
    );
    writeCsv(path.join(outDir, 'samples.csv'), allSamples, [
        'strategy',
        'second',
        'elapsedMs',
        'totalBytes',
        'bytesThisSecond',
        'mbps',
        'activeConnections',
    ]);
    writeCsv(path.join(outDir, 'connections.csv'), allRecords, [
        'strategy',
        'connectionIndex',
        'segmentIndex',
        'attempt',
        'method',
        'rangeStart',
        'rangeEnd',
        'status',
        'httpVersion',
        'ttfbMs',
        'durationMs',
        'bytes',
        'error',
        'controlledStop',
        'timeout',
        'redirects',
        'remoteAddress',
        'remotePort',
        'startedAt',
        'endedAt',
        'headers',
        'url',
    ]);

    console.log('[bench] done');
    for (const item of summary.strategies) {
        const drop = item.drop
            ? ` drop_at=${item.drop.second}s/${item.drop.mbAtDrop}MB`
            : ' drop_at=none';
        console.log(
            `[bench] ${item.strategy}: ${item.totalMB}MB avg=${item.averageMbps}Mbps max1s=${item.maxOneSecondMbps}Mbps status=${item.statuses.join(
                '|'
            )}${drop}`
        );
    }
    if (summary.skipped.length) {
        for (const item of summary.skipped) {
            console.log(`[bench] skipped ${item.strategy}: ${item.reason}`);
        }
    }
    console.log(`[bench] summary=${path.join(outDir, 'summary.json')}`);
}

main().catch((error) => {
    console.error(`[bench] failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
});
