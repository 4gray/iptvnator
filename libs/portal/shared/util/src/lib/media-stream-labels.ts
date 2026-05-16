import { MediaStreamMetadata } from 'shared-interfaces';

export interface MediaStreamMetadataInput {
    video?: unknown;
    audio?: unknown;
    subtitles?: unknown;
    title?: string | null;
    containerExtension?: string | null;
}

type MediaEntry = Record<string, unknown> | string | number;

const LANGUAGE_LABELS: Record<string, string> = {
    ar: 'ARA',
    ara: 'ARA',
    arabic: 'ARA',
    de: 'DEU',
    deu: 'DEU',
    ger: 'DEU',
    german: 'DEU',
    tedesco: 'DEU',
    en: 'ENG',
    eng: 'ENG',
    english: 'ENG',
    inglese: 'ENG',
    es: 'SPA',
    spa: 'SPA',
    spanish: 'SPA',
    espanol: 'SPA',
    fr: 'FRA',
    fra: 'FRA',
    fre: 'FRA',
    french: 'FRA',
    francais: 'FRA',
    it: 'ITA',
    ita: 'ITA',
    italian: 'ITA',
    italiano: 'ITA',
    ja: 'JPN',
    jpn: 'JPN',
    japanese: 'JPN',
    ko: 'KOR',
    kor: 'KOR',
    korean: 'KOR',
    nl: 'NLD',
    nld: 'NLD',
    dutch: 'NLD',
    pl: 'POL',
    pol: 'POL',
    polish: 'POL',
    pt: 'POR',
    por: 'POR',
    portuguese: 'POR',
    ru: 'RUS',
    rus: 'RUS',
    russian: 'RUS',
    tr: 'TUR',
    tur: 'TUR',
    turkish: 'TUR',
    zh: 'CHI',
    chi: 'CHI',
    zho: 'CHI',
    chinese: 'CHI',
};

export function buildMediaStreamMetadata(
    input: MediaStreamMetadataInput
): MediaStreamMetadata | null {
    const videoEntries = flattenMediaEntries(input.video);
    const audioEntries = flattenMediaEntries(input.audio);
    const subtitleEntries = flattenMediaEntries(input.subtitles);
    const text = `${stringifyLoose(input.video)} ${stringifyLoose(input.audio)} ${stringifyLoose(
        input.subtitles
    )} ${input.title ?? ''} ${input.containerExtension ?? ''}`;

    const dimensions =
        extractBestDimensions(videoEntries) ?? inferDimensionsFromText(text);
    const videoCodec = normalizeCodec(
        firstDefined(videoEntries.map(extractCodecFromEntry))
    );
    const qualityLabel = formatQualityLabel(dimensions?.height, videoCodec);
    const audioLanguages = unique(
        audioEntries.reduce<string[]>(
            (languages, entry) => [
                ...languages,
                ...extractLanguagesFromEntry(entry),
            ],
            []
        )
    );
    const audioCodecs = unique(
        audioEntries
            .map((entry) => normalizeCodec(extractCodecFromEntry(entry)))
            .filter(Boolean)
    );
    const subtitleLanguages = unique(
        subtitleEntries.reduce<string[]>(
            (languages, entry) => [
                ...languages,
                ...extractLanguagesFromEntry(entry),
            ],
            []
        )
    );
    const subtitleCodecs = unique(
        subtitleEntries
            .map((entry) => normalizeCodec(extractCodecFromEntry(entry)))
            .filter(Boolean)
    );

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
        qualityLabels: qualityLabel ? [qualityLabel] : [],
        width: dimensions?.width,
        widths: dimensions?.width ? [dimensions.width] : [],
        height: dimensions?.height,
        heights: dimensions?.height ? [dimensions.height] : [],
        videoCodec,
        videoCodecs: videoCodec ? [videoCodec] : [],
        audioLanguages,
        audioCodecs,
        subtitleLanguages,
        subtitleCodecs,
        source: 'xtream',
    };
}

export function mergeMediaStreamMetadata(
    primary: MediaStreamMetadata | null | undefined,
    fallback: MediaStreamMetadata | null | undefined
): MediaStreamMetadata | null {
    if (!primary && !fallback) {
        return null;
    }

    if (!primary) {
        return fallback ?? null;
    }

    if (!fallback) {
        return primary;
    }

    return {
        ...fallback,
        ...primary,
        qualityLabel: primary.qualityLabel ?? fallback.qualityLabel,
        qualityLabels: unique([
            ...(primary.qualityLabels ?? []),
            ...(primary.qualityLabel ? [primary.qualityLabel] : []),
            ...(fallback.qualityLabels ?? []),
            ...(fallback.qualityLabel ? [fallback.qualityLabel] : []),
        ]),
        width: primary.width ?? fallback.width,
        widths: uniqueNumbers([
            ...(primary.widths ?? []),
            ...(primary.width ? [primary.width] : []),
            ...(fallback.widths ?? []),
            ...(fallback.width ? [fallback.width] : []),
        ]),
        height: primary.height ?? fallback.height,
        heights: uniqueNumbers([
            ...(primary.heights ?? []),
            ...(primary.height ? [primary.height] : []),
            ...(fallback.heights ?? []),
            ...(fallback.height ? [fallback.height] : []),
        ]),
        videoCodec: primary.videoCodec ?? fallback.videoCodec,
        videoCodecs: unique([
            ...(primary.videoCodecs ?? []),
            ...(primary.videoCodec ? [primary.videoCodec] : []),
            ...(fallback.videoCodecs ?? []),
            ...(fallback.videoCodec ? [fallback.videoCodec] : []),
        ]),
        audioLanguages: unique([
            ...(primary.audioLanguages ?? []),
            ...(fallback.audioLanguages ?? []),
        ]),
        audioCodecs: unique([
            ...(primary.audioCodecs ?? []),
            ...(fallback.audioCodecs ?? []),
        ]),
        subtitleLanguages: unique([
            ...(primary.subtitleLanguages ?? []),
            ...(fallback.subtitleLanguages ?? []),
        ]),
        subtitleCodecs: unique([
            ...(primary.subtitleCodecs ?? []),
            ...(fallback.subtitleCodecs ?? []),
        ]),
        available: primary.available || fallback.available,
        source: primary.source ?? fallback.source,
        reason: primary.reason ?? fallback.reason,
    };
}

export function mediaMetadataNeedsProbe(
    metadata: MediaStreamMetadata | null | undefined
): boolean {
    return (
        (!metadata?.qualityLabel &&
            (metadata?.qualityLabels ?? []).length === 0) ||
        (metadata.audioLanguages ?? []).length === 0 ||
        (metadata.subtitleLanguages ?? []).length === 0
    );
}

export function getMediaMetadataTags(
    metadata: MediaStreamMetadata | null | undefined
): string[] {
    if (!metadata?.available) {
        return [];
    }

    const tags: string[] = [];
    if (metadata.qualityLabel) {
        tags.push(metadata.qualityLabel);
    } else if ((metadata.qualityLabels ?? []).length > 0) {
        tags.push(metadata.qualityLabels?.join(', ') ?? '');
    }

    if ((metadata.audioLanguages ?? []).length > 0) {
        tags.push(`Audio ${metadata.audioLanguages.join(', ')}`);
    } else if ((metadata.audioCodecs ?? []).length > 0) {
        tags.push(`Audio ${metadata.audioCodecs.join(', ')}`);
    }

    if ((metadata.subtitleLanguages ?? []).length > 0) {
        tags.push(`Sub ${metadata.subtitleLanguages.join(', ')}`);
    } else if ((metadata.subtitleCodecs ?? []).length > 0) {
        tags.push(`Sub ${metadata.subtitleCodecs.join(', ')}`);
    }

    return tags;
}

export function getMediaMetadataUnavailableTag(
    metadata: MediaStreamMetadata | null | undefined
): string | null {
    if (!metadata || metadata.available) {
        return null;
    }

    const reason = (metadata.reason ?? '').toLowerCase();
    if (
        reason.includes('access blocked') ||
        reason.includes('accesso disabilitato') ||
        reason.includes('returned html')
    ) {
        return 'Accesso bloccato/VPN';
    }

    if (reason.includes('probe is not available')) {
        return 'Probe non disponibile';
    }

    return 'Qualita non rilevata';
}

function flattenMediaEntries(value: unknown): MediaEntry[] {
    if (value === null || value === undefined) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.reduce<MediaEntry[]>(
            (entries, item) => [...entries, ...flattenMediaEntries(item)],
            []
        );
    }

    if (typeof value === 'string' || typeof value === 'number') {
        return [value];
    }

    if (typeof value !== 'object') {
        return [];
    }

    const record = value as Record<string, unknown>;
    const nested = Object.values(record).filter(
        (entry) => Array.isArray(entry) || isPlainObject(entry)
    );

    if (
        nested.length > 0 &&
        !('codec_name' in record) &&
        !('codec_type' in record) &&
        !('width' in record) &&
        !('height' in record)
    ) {
        return nested.reduce<MediaEntry[]>(
            (entries, entry) => [...entries, ...flattenMediaEntries(entry)],
            []
        );
    }

    return [record];
}

function extractBestDimensions(
    entries: MediaEntry[]
): { width?: number; height: number } | null {
    let best: { width?: number; height: number } | null = null;

    for (const entry of entries) {
        const width = getNumericField(entry, ['width', 'coded_width']);
        const height = getNumericField(entry, ['height', 'coded_height']);
        if (!height) {
            continue;
        }

        if (!best || height > best.height) {
            best = { width, height };
        }
    }

    return best;
}

function inferDimensionsFromText(
    text: string
): { width?: number; height: number } | null {
    const normalized = text.toLowerCase();
    const explicit = normalized.match(/\b(2160|1440|1080|720|576|480|360)p?\b/);
    if (explicit) {
        return { height: Number(explicit[1]) };
    }

    if (/\b(uhd|4k)\b/.test(normalized)) {
        return { height: 2160 };
    }

    if (/\b(fhd|fullhd|full hd)\b/.test(normalized)) {
        return { height: 1080 };
    }

    if (/\bhd\b/.test(normalized)) {
        return { height: 720 };
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

function extractLanguagesFromEntry(entry: MediaEntry): string[] {
    const candidates = [
        getStringField(entry, ['language', 'lang']),
        getNestedStringField(entry, ['tags', 'language']),
        getNestedStringField(entry, ['tags', 'LANGUAGE']),
        getStringField(entry, ['title']),
        getNestedStringField(entry, ['tags', 'title']),
    ].filter(Boolean);

    return unique(
        candidates.reduce<string[]>(
            (labels, candidate) => [
                ...labels,
                ...extractLanguageLabels(candidate ?? ''),
            ],
            []
        )
    );
}

function extractLanguageLabels(value: string): string[] {
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const tokens = normalized.match(/[a-z]{2,}/g) ?? [];
    return unique(
        tokens
            .map((token) => LANGUAGE_LABELS[token])
            .filter((label): label is string => Boolean(label))
    );
}

function extractCodecFromEntry(entry: MediaEntry): string | undefined {
    return getStringField(entry, [
        'codec_name',
        'codec',
        'format',
        'codec_tag_string',
    ]);
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

function getNumericField(
    entry: MediaEntry,
    fields: string[]
): number | undefined {
    if (!isPlainObject(entry)) {
        return undefined;
    }

    for (const field of fields) {
        const value = Number(entry[field]);
        if (Number.isFinite(value) && value > 0) {
            return value;
        }
    }

    return undefined;
}

function getStringField(
    entry: MediaEntry,
    fields: string[]
): string | undefined {
    if (typeof entry === 'string' || typeof entry === 'number') {
        return String(entry);
    }

    if (!isPlainObject(entry)) {
        return undefined;
    }

    for (const field of fields) {
        const value = entry[field];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

function getNestedStringField(
    entry: MediaEntry,
    path: [string, string]
): string | undefined {
    if (!isPlainObject(entry)) {
        return undefined;
    }

    const parent = entry[path[0]];
    if (!isPlainObject(parent)) {
        return undefined;
    }

    const value = parent[path[1]];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstDefined<T>(values: (T | undefined)[]): T | undefined {
    return values.find((value) => value !== undefined);
}

function stringifyLoose(value: unknown): string {
    try {
        return typeof value === 'string' ? value : JSON.stringify(value ?? '');
    } catch {
        return '';
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function uniqueNumbers(values: number[]): number[] {
    return Array.from(
        new Set(values.filter((value) => Number.isFinite(value) && value > 0))
    );
}
