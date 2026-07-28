import type {
    VodSourceCandidate,
    VodSourceField,
} from '@iptvnator/shared/interfaces';

/**
 * Metadata extraction for VOD multi-source rows.
 *
 * The governing rule: a value inferred from a filename is a GUESS and must
 * never be presented, sorted, or acted on as though the provider had stated
 * it. Everything here returns `provenance: 'parsed'`; facts come from
 * `applyApiMetadata` below, and reachability from the probe.
 *
 * Empty beats wrong — when a pattern does not match, the field stays
 * `undefined` and the row simply shows no tag, plus a "check" affordance.
 */

/**
 * Unicode-aware word boundary.
 *
 * JavaScript's `\b` is ASCII-only, so `/\bдубляж\b/` never matches — which
 * would silently drop the dub tag on exactly the Cyrillic catalogues where it
 * matters most. Lookarounds over `\p{L}\p{N}` give a real boundary.
 */
function bounded(source: string): RegExp {
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Release-quality tags, most specific first so "4K" wins over "1080p". */
const QUALITY_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [bounded('2160p|4k|uhd'), '2160p'],
    [bounded('1440p'), '1440p'],
    [bounded('1080[pi]'), '1080p'],
    [bounded('720[pi]'), '720p'],
    [bounded('576[pi]'), '576p'],
    [bounded('480[pi]'), '480p'],
];

const CODEC_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [bounded('hevc|h\\.?265|x265'), 'HEVC'],
    [bounded('avc|h\\.?264|x264'), 'H.264'],
    [bounded('av1'), 'AV1'],
    [bounded('mpeg-?2'), 'MPEG-2'],
];

/**
 * Dub/voice-over markers. The single most valuable field to a user and the
 * least likely to be stated by any provider, so it is worth guessing — but
 * only ever as a guess.
 */
const AUDIO_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [bounded('дубляж|dub'), 'Дубляж'],
    [bounded('mvo'), 'MVO'],
    [bounded('dvo'), 'DVO'],
    [bounded('avo'), 'AVO'],
    [bounded('субтитры|subs|sub'), 'Sub'],
    [bounded('eng|english'), 'Eng'],
    [bounded('rus|russian|рус'), 'Rus'],
    [bounded('ukr|ukrainian|укр'), 'Ukr'],
];

const HDR_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [bounded('dolby\\s?vision|dv'), 'Dolby Vision'],
    [bounded('hdr10\\+'), 'HDR10+'],
    [bounded('hdr'), 'HDR'],
];

function matchFirst(
    raw: string,
    patterns: ReadonlyArray<[RegExp, string]>
): VodSourceField | undefined {
    for (const [pattern, value] of patterns) {
        if (pattern.test(raw)) {
            return { value, provenance: 'parsed' };
        }
    }
    return undefined;
}

export interface ParsedTitleMetadata {
    quality?: VodSourceField;
    codec?: VodSourceField;
    audio?: VodSourceField;
    hdr?: VodSourceField;
}

/**
 * Infer what the title string is willing to admit. Everything returned is a
 * guess, tagged as such.
 */
export function parseTitleMetadata(
    rawTitle: string | null | undefined
): ParsedTitleMetadata {
    if (!rawTitle) {
        return {};
    }

    return {
        quality: matchFirst(rawTitle, QUALITY_PATTERNS),
        codec: matchFirst(rawTitle, CODEC_PATTERNS),
        audio: matchFirst(rawTitle, AUDIO_PATTERNS),
        hdr: matchFirst(rawTitle, HDR_PATTERNS),
    };
}

/** Metadata a provider actually stated, from `get_vod_info`. */
export interface ProviderVodMetadata {
    containerExtension?: string | null;
    videoCodec?: string | null;
    audioCodec?: string | null;
    /** Pixel width from the provider's own video stream info. */
    width?: number | null;
    /** Pixel height from the provider's own video stream info. */
    height?: number | null;
}

/**
 * Overlay provider-stated facts on top of parsed guesses.
 *
 * A fact always wins: once the portal says the container is `mkv`, the guess
 * is discarded rather than shown alongside it. A missing fact never erases an
 * existing guess — that would trade a marked guess for nothing.
 */
export function applyApiMetadata(
    candidate: VodSourceCandidate,
    api: ProviderVodMetadata
): VodSourceCandidate {
    const next: VodSourceCandidate = { ...candidate };

    const container = cleanString(api.containerExtension);
    if (container) {
        next.container = { value: container, provenance: 'api' };
    }

    const codec = normalizeCodecName(api.videoCodec);
    if (codec) {
        next.codec = { value: codec, provenance: 'api' };
    }

    const audio = normalizeCodecName(api.audioCodec);
    if (audio) {
        next.audio = { value: audio, provenance: 'api' };
    }

    const quality = qualityFromDimensions(api.width, api.height);
    if (quality) {
        next.quality = { value: quality, provenance: 'api' };
    }

    return next;
}

/**
 * The only sanctioned way to read metadata for ranking or automatic choices.
 *
 * Guessed values are structurally unreachable from here, which is what stops
 * "~2160p parsed off a filename" from outranking a source we actually
 * verified. Presentation code reads the fields directly; decision code must
 * come through this.
 */
export function factualOnly(
    candidate: VodSourceCandidate
): Pick<VodSourceCandidate, 'quality' | 'codec' | 'container' | 'audio'> {
    const keep = (field?: VodSourceField) =>
        field && field.provenance !== 'parsed' ? field : undefined;

    return {
        quality: keep(candidate.quality),
        codec: keep(candidate.codec),
        container: keep(candidate.container),
        audio: keep(candidate.audio),
    };
}

/**
 * True when both sides state an audio track AS FACT and those facts differ.
 *
 * Deliberately conservative: two guesses, or a guess against a fact, are not
 * enough to claim the dub changed. The warning must be trustworthy, so it
 * fires only when both sides are known — and stays silent when we simply do
 * not know, which is the common case.
 */
export function audioDiffersFactually(
    from: VodSourceCandidate | null | undefined,
    to: VodSourceCandidate | null | undefined
): boolean {
    const a = from && factualOnly(from).audio?.value;
    const b = to && factualOnly(to).audio?.value;
    return Boolean(a && b && a !== b);
}

function cleanString(raw: string | null | undefined): string | null {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    return trimmed === '' ? null : trimmed;
}

/** Map ffmpeg-style codec names onto the labels users recognize. */
function normalizeCodecName(raw: string | null | undefined): string | null {
    const value = cleanString(raw);
    if (!value) {
        return null;
    }

    const lower = value.toLowerCase();
    if (lower === 'hevc' || lower === 'h265') {
        return 'HEVC';
    }
    if (lower === 'h264' || lower === 'avc') {
        return 'H.264';
    }
    return value;
}

/** Standard frame heights, for recognizing an uncropped master. */
const STANDARD_HEIGHTS: ReadonlyArray<[number, string]> = [
    [2160, '2160p'],
    [1440, '1440p'],
    [1080, '1080p'],
    [720, '720p'],
    [576, '576p'],
    [480, '480p'],
];

function isPositiveNumber(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Derive the quality label from real pixel dimensions.
 *
 * Width is authoritative because letterboxed masters are cropped vertically:
 * a 2.39:1 "1080p" film is 1920×800, and 800 alone is indistinguishable from
 * a 1280×800 720p-class encode. Bucketing that by height would emit "720p"
 * labelled as a FACT — precisely the kind of confident wrongness this feature
 * exists to avoid.
 *
 * With no width, a height is only trusted when it is (near) a standard frame
 * height. Anything else returns null, so the row shows no tag and offers a
 * check instead. Empty beats wrong.
 */
/**
 * The sub-HD formats, matched rather than bucketed.
 *
 * Ranges work above 900 because the encodes cluster there. Below it they do
 * not: 800×600 and 800×450 are neither 480p nor each other, and 720 is NTSC
 * 480p or PAL 576p depending only on the height. Anything that is not one of
 * these shapes gets no tag at all — a bucket here would be published with
 * `api` provenance and read as a measurement.
 */
const SMALL_FORMATS: ReadonlyArray<[number, number, string]> = [
    [854, 480, '480p'],
    [720, 576, '576p'],
    [720, 480, '480p'],
    [640, 360, '360p'],
];

function within5Percent(value: number, reference: number): boolean {
    return Math.abs(value - reference) / reference <= 0.05;
}

function smallFormatQuality(
    width: number,
    height: number | null | undefined
): string | null {
    const byWidth = SMALL_FORMATS.filter(([reference]) =>
        within5Percent(width, reference)
    );
    if (byWidth.length === 0) {
        return null;
    }
    if (byWidth.length === 1) {
        return byWidth[0][2];
    }

    // One width, two formats: only the height separates them.
    if (!isPositiveNumber(height)) {
        return null;
    }
    const exact = byWidth.find(([, reference]) =>
        within5Percent(height, reference)
    );
    return exact ? exact[2] : null;
}

function qualityFromDimensions(
    width: number | null | undefined,
    height: number | null | undefined
): string | null {
    if (isPositiveNumber(width)) {
        if (width >= 3400) {
            return '2160p';
        }
        if (width >= 2400) {
            return '1440p';
        }
        if (width >= 1700) {
            return '1080p';
        }
        if (width >= 1200) {
            return '720p';
        }
        if (width >= 900) {
            return '576p';
        }
        return smallFormatQuality(width, height);
    }

    if (!isPositiveNumber(height)) {
        return null;
    }

    const standard = STANDARD_HEIGHTS.find(
        ([reference]) => Math.abs(height - reference) / reference <= 0.05
    );
    return standard ? standard[1] : null;
}
