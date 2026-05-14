import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { delimiter, join } from 'path';

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const FETCH_PROBE_TIMEOUT_MS = 20_000;
const FETCH_PROBE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) IPTVnator/0.22 Safari/537.36';
let cachedFfprobePath: string | null | undefined;

interface MediaStreamMetadata {
    available: boolean;
    qualityLabel?: string;
    width?: number;
    height?: number;
    videoCodec?: string;
    audioLanguages: string[];
    audioCodecs: string[];
    subtitleLanguages: string[];
    subtitleCodecs: string[];
    source?: 'xtream' | 'ffprobe' | 'derived';
    reason?: string;
}

interface MediaStreamMetadataProbeRequest {
    url: string;
    headers?: Record<string, string>;
}

type FfprobeStream = {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    coded_width?: number;
    coded_height?: number;
    tags?: Record<string, string>;
};

type FfprobeOutput = {
    streams?: FfprobeStream[];
};

export async function probeMediaStreamMetadata(
    request: MediaStreamMetadataProbeRequest
): Promise<MediaStreamMetadata> {
    if (!isHttpUrl(request.url)) {
        return unavailable('Only HTTP(S) streams can be probed');
    }

    let fetchProbeReason: string | undefined;

    try {
        const fetchedMetadata = await probeWithAppFetch(request);
        if (fetchedMetadata.available) {
            return fetchedMetadata;
        }

        fetchProbeReason = fetchedMetadata.reason;
        if (isAccessBlockedReason(fetchProbeReason)) {
            return fetchedMetadata;
        }
    } catch (error) {
        fetchProbeReason = normalizeError(error);
    }

    try {
        const output = await runFfprobe(request);
        const parsed = JSON.parse(output) as FfprobeOutput;
        return metadataFromFfprobe(parsed);
    } catch (error) {
        return unavailable(
            joinReasons(fetchProbeReason, normalizeError(error))
        );
    }
}

async function runFfprobe(
    request: MediaStreamMetadataProbeRequest
): Promise<string> {
    const headers = normalizeHeaders(request.headers);
    const args = [
        '-v',
        'error',
        '-hide_banner',
        '-print_format',
        'json',
        '-show_streams',
        '-analyzeduration',
        '5000000',
        '-probesize',
        '5000000',
        '-rw_timeout',
        '10000000',
    ];

    const userAgent = findHeader(headers, 'User-Agent');
    if (userAgent) {
        args.push('-user_agent', userAgent);
    }

    const referer = findHeader(headers, 'Referer');
    if (referer) {
        args.push('-referer', referer);
    }

    const headerBlock = buildHeaderBlock(headers);
    if (headerBlock) {
        args.push('-headers', headerBlock);
    }

    args.push('-i', request.url);

    return new Promise((resolve, reject) => {
        const ffprobePath = resolveFfprobePath();
        const child = spawn(ffprobePath, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error('Media probe timed out'));
        }, DEFAULT_PROBE_TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout = appendLimited(stdout, chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = appendLimited(stderr, chunk);
        });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (code !== 0) {
                const message = stderr.toString('utf8').trim();
                reject(
                    new Error(message || `ffprobe exited with code ${code}`)
                );
                return;
            }

            resolve(stdout.toString('utf8'));
        });
    });
}

async function probeWithAppFetch(
    request: MediaStreamMetadataProbeRequest
): Promise<MediaStreamMetadata> {
    const fetched = await fetchMediaPrefix(request.url, request.headers);
    const textPrefix = getTextPrefix(fetched.buffer);

    if (looksLikeHtml(fetched.contentType, textPrefix)) {
        return unavailable(
            textPrefix.toLowerCase().includes('accesso disabilitato')
                ? 'Access blocked: server returned the Accesso disabilitato HTML page'
                : 'Access blocked: server returned HTML instead of media'
        );
    }

    if (isHlsPlaylist(fetched.contentType, textPrefix, request.url)) {
        return probeHlsPlaylist(request.url, textPrefix, request.headers);
    }

    return probeFetchedMediaBuffer(fetched.buffer);
}

async function probeHlsPlaylist(
    playlistUrl: string,
    playlistText: string,
    headers?: Record<string, string>
): Promise<MediaStreamMetadata> {
    const playlistMetadata = metadataFromHlsPlaylist(playlistText);
    if (playlistMetadata) {
        return playlistMetadata;
    }

    const segmentRequest = resolveHlsProbeSegmentRequest(
        playlistText,
        playlistUrl
    );
    if (!segmentRequest) {
        return unavailable('HLS playlist does not expose media metadata');
    }

    const buffers: Buffer[] = [];
    if (segmentRequest.initUrl) {
        const initSegment = await fetchMediaPrefix(
            segmentRequest.initUrl,
            headers,
            1024 * 1024
        );
        buffers.push(initSegment.buffer);
    }

    const mediaSegment = await fetchMediaPrefix(
        segmentRequest.segmentUrl,
        headers,
        FETCH_PROBE_BYTES
    );
    buffers.push(mediaSegment.buffer);

    return probeFetchedMediaBuffer(Buffer.concat(buffers));
}

async function probeFetchedMediaBuffer(
    buffer: Buffer
): Promise<MediaStreamMetadata> {
    if (buffer.length === 0) {
        return unavailable('Fetched media probe returned no bytes');
    }

    const output = await runFfprobeOnBuffer(buffer);
    const parsed = JSON.parse(output) as FfprobeOutput;
    const metadata = metadataFromFfprobe(parsed);
    return metadata.available ? { ...metadata, source: 'ffprobe' } : metadata;
}

async function fetchMediaPrefix(
    url: string,
    headers?: Record<string, string>,
    maxBytes = FETCH_PROBE_BYTES
): Promise<{ buffer: Buffer; contentType: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_PROBE_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            headers: buildFetchHeaders(headers),
            redirect: 'follow',
            signal: controller.signal,
        });

        const buffer = await readResponsePrefix(response, maxBytes);
        if (!response.ok) {
            return {
                buffer,
                contentType: response.headers.get('content-type') ?? '',
            };
        }

        return {
            buffer,
            contentType: response.headers.get('content-type') ?? '',
        };
    } finally {
        clearTimeout(timer);
    }
}

async function readResponsePrefix(
    response: Response,
    maxBytes: number
): Promise<Buffer> {
    if (!response.body) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer).subarray(0, maxBytes);
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
        while (totalBytes < maxBytes) {
            const { done, value } = await reader.read();
            if (done || !value) {
                break;
            }

            const chunk = Buffer.from(value);
            const remainingBytes = maxBytes - totalBytes;
            chunks.push(
                chunk.length > remainingBytes
                    ? chunk.subarray(0, remainingBytes)
                    : chunk
            );
            totalBytes += Math.min(chunk.length, remainingBytes);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }

    return Buffer.concat(chunks, totalBytes);
}

function buildFetchHeaders(headers?: Record<string, string>): HeadersInit {
    const normalized = normalizeHeaders(headers);
    if (!findHeader(normalized, 'User-Agent')) {
        normalized['User-Agent'] = DEFAULT_USER_AGENT;
    }
    if (!findHeader(normalized, 'Accept')) {
        normalized.Accept = '*/*';
    }
    return normalized;
}

function runFfprobeOnBuffer(buffer: Buffer): Promise<string> {
    const args = [
        '-v',
        'error',
        '-hide_banner',
        '-print_format',
        'json',
        '-show_streams',
        '-analyzeduration',
        '5000000',
        '-probesize',
        '5000000',
        '-i',
        'pipe:0',
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(resolveFfprobePath(), args, {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error('Media probe timed out'));
        }, DEFAULT_PROBE_TIMEOUT_MS);

        child.stdin.on('error', () => undefined);
        child.stdout.on('data', (chunk: Buffer) => {
            stdout = appendLimited(stdout, chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr = appendLimited(stderr, chunk);
        });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            if (code !== 0) {
                const message = stderr.toString('utf8').trim();
                reject(
                    new Error(message || `ffprobe exited with code ${code}`)
                );
                return;
            }

            resolve(stdout.toString('utf8'));
        });
        child.stdin.end(buffer);
    });
}

function metadataFromFfprobe(output: FfprobeOutput): MediaStreamMetadata {
    const streams = Array.isArray(output.streams) ? output.streams : [];
    const videoStreams = streams.filter(
        (stream) => stream.codec_type === 'video'
    );
    const audioStreams = streams.filter(
        (stream) => stream.codec_type === 'audio'
    );
    const subtitleStreams = streams.filter(
        (stream) => stream.codec_type === 'subtitle'
    );
    const bestVideo = videoStreams.reduce<FfprobeStream | null>(
        (best, stream) => {
            const streamHeight = stream.height ?? stream.coded_height ?? 0;
            const bestHeight = best?.height ?? best?.coded_height ?? 0;
            return streamHeight > bestHeight ? stream : best;
        },
        videoStreams[0] ?? null
    );
    const height = bestVideo?.height ?? bestVideo?.coded_height;
    const width = bestVideo?.width ?? bestVideo?.coded_width;
    const videoCodec = normalizeCodec(bestVideo?.codec_name);
    const audioLanguages = unique(
        audioStreams.flatMap((stream) =>
            normalizeLanguage(stream.tags?.language ?? stream.tags?.LANGUAGE)
        )
    );
    const audioCodecs = unique(
        audioStreams
            .map((stream) => normalizeCodec(stream.codec_name))
            .filter((codec): codec is string => Boolean(codec))
    );
    const subtitleLanguages = unique(
        subtitleStreams.flatMap((stream) =>
            normalizeLanguage(
                stream.tags?.language ??
                    stream.tags?.LANGUAGE ??
                    stream.tags?.title
            )
        )
    );
    const subtitleCodecs = unique(
        subtitleStreams
            .map((stream) => normalizeCodec(stream.codec_name))
            .filter((codec): codec is string => Boolean(codec))
    );

    if (
        !height &&
        audioLanguages.length === 0 &&
        audioCodecs.length === 0 &&
        subtitleLanguages.length === 0 &&
        subtitleCodecs.length === 0
    ) {
        return unavailable('No video or audio streams detected by ffprobe');
    }

    return {
        available: true,
        qualityLabel: formatQualityLabel(height, videoCodec),
        width,
        height,
        videoCodec,
        audioLanguages,
        audioCodecs,
        subtitleLanguages,
        subtitleCodecs,
        source: 'ffprobe',
    };
}

function metadataFromHlsPlaylist(text: string): MediaStreamMetadata | null {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const streamInfos = lines
        .filter((line) => line.toUpperCase().startsWith('#EXT-X-STREAM-INF:'))
        .map((line) => parseHlsAttributes(line.split(':').slice(1).join(':')));
    const bestVariant = streamInfos.reduce<{
        width?: number;
        height: number;
        codecs?: string;
    } | null>((best, attrs) => {
        const resolution = parseResolution(attrs['RESOLUTION']);
        if (!resolution?.height) {
            return best;
        }

        const candidate = {
            width: resolution.width,
            height: resolution.height,
            codecs: attrs['CODECS'],
        };
        if (!best || candidate.height > best.height) {
            return candidate;
        }
        return best;
    }, null);
    const audioLanguages = unique(
        lines
            .filter((line) => line.toUpperCase().startsWith('#EXT-X-MEDIA:'))
            .map((line) =>
                parseHlsAttributes(line.split(':').slice(1).join(':'))
            )
            .filter((attrs) => attrs['TYPE']?.toUpperCase() === 'AUDIO')
            .flatMap((attrs) =>
                normalizeLanguage(attrs['LANGUAGE'] ?? attrs['NAME'])
            )
    );
    const subtitleLanguages = unique(
        lines
            .filter((line) => line.toUpperCase().startsWith('#EXT-X-MEDIA:'))
            .map((line) =>
                parseHlsAttributes(line.split(':').slice(1).join(':'))
            )
            .filter((attrs) => {
                const type = attrs['TYPE']?.toUpperCase();
                return type === 'SUBTITLES' || type === 'CLOSED-CAPTIONS';
            })
            .flatMap((attrs) =>
                normalizeLanguage(attrs['LANGUAGE'] ?? attrs['NAME'])
            )
    );
    const videoCodec = normalizeHlsVideoCodec(bestVariant?.codecs);
    const audioCodecs = unique(
        streamInfos
            .map((attrs) => normalizeHlsAudioCodec(attrs['CODECS']))
            .filter((codec): codec is string => Boolean(codec))
    );
    const subtitleCodecs = subtitleLanguages.length > 0 ? ['HLS'] : [];
    const qualityLabel = formatQualityLabel(bestVariant?.height, videoCodec);

    if (
        !qualityLabel &&
        audioLanguages.length === 0 &&
        audioCodecs.length === 0 &&
        subtitleLanguages.length === 0 &&
        subtitleCodecs.length === 0
    ) {
        return null;
    }

    return {
        available: true,
        qualityLabel,
        width: bestVariant?.width,
        height: bestVariant?.height,
        videoCodec,
        audioLanguages,
        audioCodecs,
        subtitleLanguages,
        subtitleCodecs,
        source: 'derived',
    };
}

function parseHlsAttributes(value: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
        attrs[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
    }
    return attrs;
}

function parseResolution(
    value: string | undefined
): { width?: number; height: number } | null {
    const match = value?.match(/^(\d+)x(\d+)$/i);
    if (!match) {
        return null;
    }

    return {
        width: Number(match[1]),
        height: Number(match[2]),
    };
}

function normalizeHlsVideoCodec(
    codecs: string | undefined
): string | undefined {
    if (!codecs) {
        return undefined;
    }

    const normalized = codecs.toLowerCase();
    if (/\b(hvc1|hev1)\b/.test(normalized)) return 'HEVC';
    if (/\b(avc1|avc3)\b/.test(normalized)) return 'H.264';
    if (/\bav01\b/.test(normalized)) return 'AV1';
    if (/\bvp09\b/.test(normalized)) return 'VP9';
    return undefined;
}

function normalizeHlsAudioCodec(
    codecs: string | undefined
): string | undefined {
    if (!codecs) {
        return undefined;
    }

    const normalized = codecs.toLowerCase();
    if (/\bmp4a\b/.test(normalized)) return 'AAC';
    if (/\bac-3\b/.test(normalized)) return 'AC3';
    if (/\bec-3\b/.test(normalized)) return 'EAC3';
    if (/\bopus\b/.test(normalized)) return 'Opus';
    return undefined;
}

function resolveHlsProbeSegmentRequest(
    text: string,
    playlistUrl: string
): { initUrl?: string; segmentUrl: string } | null {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    let initUrl: string | undefined;

    for (const line of lines) {
        if (line.toUpperCase().startsWith('#EXT-X-MAP:')) {
            const attrs = parseHlsAttributes(
                line.split(':').slice(1).join(':')
            );
            if (attrs['URI']) {
                initUrl = new URL(attrs['URI'], playlistUrl).toString();
            }
            continue;
        }

        if (line.startsWith('#')) {
            continue;
        }

        return {
            initUrl,
            segmentUrl: new URL(line, playlistUrl).toString(),
        };
    }

    return null;
}

function formatQualityLabel(
    height: number | undefined,
    videoCodec: string | undefined
): string | undefined {
    if (!height) {
        return undefined;
    }

    const quality =
        height >= 2160
            ? '2160p'
            : height >= 1440
              ? '1440p'
              : height >= 1080
                ? '1080p'
                : height >= 720
                  ? '720p'
                  : `${height}p`;

    return videoCodec ? `${quality} ${videoCodec}` : quality;
}

function normalizeCodec(codec: string | undefined): string | undefined {
    if (!codec) {
        return undefined;
    }

    const normalized = codec.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }

    if (['hevc', 'h265', 'h.265'].includes(normalized)) return 'HEVC';
    if (['h264', 'h.264', 'avc1'].includes(normalized)) return 'H.264';
    if (['aac', 'aac_latm'].includes(normalized)) return 'AAC';
    if (['ac3', 'ac-3'].includes(normalized)) return 'AC3';
    if (['eac3', 'e-ac-3'].includes(normalized)) return 'EAC3';
    if (normalized === 'dts') return 'DTS';
    if (normalized === 'truehd') return 'TrueHD';
    if (normalized === 'opus') return 'Opus';
    if (normalized === 'mp3') return 'MP3';
    if (normalized === 'mpeg2video') return 'MPEG-2';
    if (normalized === 'av1') return 'AV1';
    if (normalized === 'vp9') return 'VP9';

    return codec.trim().toUpperCase();
}

function normalizeLanguage(language: string | undefined): string[] {
    if (!language) {
        return [];
    }

    const token = language.trim().toLowerCase();
    const labels: Record<string, string> = {
        ar: 'ARA',
        ara: 'ARA',
        de: 'DEU',
        deu: 'DEU',
        ger: 'DEU',
        en: 'ENG',
        eng: 'ENG',
        es: 'SPA',
        spa: 'SPA',
        fr: 'FRA',
        fra: 'FRA',
        fre: 'FRA',
        it: 'ITA',
        ita: 'ITA',
        ja: 'JPN',
        jpn: 'JPN',
        ko: 'KOR',
        kor: 'KOR',
        nl: 'NLD',
        nld: 'NLD',
        pl: 'POL',
        pol: 'POL',
        pt: 'POR',
        por: 'POR',
        ru: 'RUS',
        rus: 'RUS',
        tr: 'TUR',
        tur: 'TUR',
        zh: 'CHI',
        chi: 'CHI',
        zho: 'CHI',
    };

    if (labels[token]) {
        return [labels[token]];
    }

    return /^[a-z]{3}$/.test(token) ? [token.toUpperCase()] : [];
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

function findHeader(
    headers: Record<string, string>,
    target: string
): string | undefined {
    const lowerTarget = target.toLowerCase();
    const entry = Object.entries(headers).find(
        ([name]) => name.toLowerCase() === lowerTarget
    );
    return entry?.[1];
}

function buildHeaderBlock(headers: Record<string, string>): string {
    const headerLines = Object.entries(headers)
        .filter(([name]) => {
            const lower = name.toLowerCase();
            return lower !== 'user-agent' && lower !== 'referer';
        })
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n');

    return headerLines ? `${headerLines}\r\n` : '';
}

function getTextPrefix(buffer: Buffer): string {
    return buffer
        .subarray(0, 64 * 1024)
        .toString('utf8')
        .trimStart();
}

function looksLikeHtml(contentType: string, textPrefix: string): boolean {
    return (
        contentType.toLowerCase().includes('text/html') ||
        /^<!doctype html\b/i.test(textPrefix) ||
        /^<html\b/i.test(textPrefix)
    );
}

function isHlsPlaylist(
    contentType: string,
    textPrefix: string,
    url: string
): boolean {
    const normalizedContentType = contentType.toLowerCase();
    return (
        /\.m3u8(?:[?#]|$)/i.test(url) ||
        normalizedContentType.includes('mpegurl') ||
        normalizedContentType.includes('vnd.apple.mpegurl') ||
        textPrefix.startsWith('#EXTM3U')
    );
}

function normalizeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function joinReasons(
    primary: string | undefined,
    fallback: string | undefined
): string {
    if (primary && fallback && primary !== fallback) {
        return `${primary}; direct ffprobe: ${fallback}`;
    }
    return primary ?? fallback ?? 'Media metadata probe failed';
}

function isAccessBlockedReason(reason: string | undefined): boolean {
    const normalized = reason?.toLowerCase() ?? '';
    return (
        normalized.includes('access blocked') ||
        normalized.includes('accesso disabilitato') ||
        normalized.includes('returned html')
    );
}

function resolveFfprobePath(): string {
    if (cachedFfprobePath !== undefined) {
        return cachedFfprobePath ?? 'ffprobe';
    }

    const explicitPath = process.env['FFPROBE_PATH']?.trim();
    if (explicitPath) {
        cachedFfprobePath = explicitPath;
        return explicitPath;
    }

    cachedFfprobePath =
        getFfprobeCandidates().find((candidate) => existsSync(candidate)) ??
        null;
    return cachedFfprobePath ?? 'ffprobe';
}

function getFfprobeCandidates(): string[] {
    return unique([
        ...getPathFfprobeCandidates(),
        ...getWindowsFfprobeCandidates(),
    ]);
}

function getPathFfprobeCandidates(): string[] {
    return (process.env['PATH'] ?? '')
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .flatMap((entry) => [
            join(
                entry,
                process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
            ),
            join(entry, 'ffprobe'),
        ]);
}

function getWindowsFfprobeCandidates(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }

    const candidates = [
        findWingetFfprobeCandidate(),
        process.env['ProgramData']
            ? join(
                  process.env['ProgramData'],
                  'chocolatey',
                  'bin',
                  'ffprobe.exe'
              )
            : undefined,
        process.env['USERPROFILE']
            ? join(process.env['USERPROFILE'], 'scoop', 'shims', 'ffprobe.exe')
            : undefined,
    ];

    return candidates.filter((candidate): candidate is string =>
        Boolean(candidate)
    );
}

function findWingetFfprobeCandidate(): string | undefined {
    const localAppData = process.env['LOCALAPPDATA'];
    if (!localAppData) {
        return undefined;
    }

    const packagesPath = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    try {
        for (const packageDir of readdirSync(packagesPath, {
            withFileTypes: true,
        })) {
            if (!packageDir.isDirectory() || !/ffmpeg/i.test(packageDir.name)) {
                continue;
            }

            const packagePath = join(packagesPath, packageDir.name);
            const directCandidate = join(packagePath, 'bin', 'ffprobe.exe');
            if (existsSync(directCandidate)) {
                return directCandidate;
            }

            for (const childDir of readdirSync(packagePath, {
                withFileTypes: true,
            })) {
                if (!childDir.isDirectory()) {
                    continue;
                }

                const nestedCandidate = join(
                    packagePath,
                    childDir.name,
                    'bin',
                    'ffprobe.exe'
                );
                if (existsSync(nestedCandidate)) {
                    return nestedCandidate;
                }
            }
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function appendLimited(buffer: Buffer, chunk: Buffer): Buffer {
    if (buffer.length >= MAX_OUTPUT_BYTES) {
        return buffer;
    }

    const next = Buffer.concat([buffer, chunk]);
    return next.length > MAX_OUTPUT_BYTES
        ? next.subarray(0, MAX_OUTPUT_BYTES)
        : next;
}

function unavailable(reason: string): MediaStreamMetadata {
    return {
        available: false,
        audioLanguages: [],
        audioCodecs: [],
        subtitleLanguages: [],
        subtitleCodecs: [],
        reason,
    };
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function isHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}
