/**
 * Minimal SRT/WebVTT cue extraction for user-supplied subtitle files.
 *
 * The web engines render external subtitles through native `TextTrack`s, so
 * only start/end/text are needed — positioning and styling blocks are
 * intentionally dropped. ASS/SSA is NOT handled here: rendering it faithfully
 * needs libass, so the web engines simply do not accept those files (the
 * Embedded MPV engine plays them natively instead).
 */

export interface ParsedSubtitleCue {
    startSeconds: number;
    endSeconds: number;
    text: string;
}

export type ExternalSubtitleFormat = 'srt' | 'vtt';

export interface ExternalSubtitleFile {
    /** Display name, usually the picked file's name. */
    name: string;
    format: ExternalSubtitleFormat;
    content: string;
}

/** Extensions the web engines accept in their file picker. */
export const WEB_SUBTITLE_FILE_EXTENSIONS = ['.srt', '.vtt'] as const;

export function detectExternalSubtitleFormat(
    fileName: string
): ExternalSubtitleFormat | null {
    const normalized = fileName.trim().toLowerCase();
    if (normalized.endsWith('.srt')) {
        return 'srt';
    }
    if (normalized.endsWith('.vtt')) {
        return 'vtt';
    }
    return null;
}

/**
 * Decodes a picked subtitle file's bytes. `Blob.text()` is strictly UTF-8 with
 * silent U+FFFD substitution, which turns the still-common legacy-encoded SRT
 * files (Windows-1251 Cyrillic, Windows-1252 Western European) and Windows'
 * UTF-16 saves into mojibake that parses "successfully". Best-effort order:
 * UTF-16 BOMs, then strict UTF-8, then a single-byte fallback chosen by the
 * plausibility of the decoded text (see {@link chooseLegacySingleByteDecode}).
 */
export function decodeExternalSubtitleBytes(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 2) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
            return new TextDecoder('utf-16le').decode(buffer);
        }
        if (bytes[0] === 0xfe && bytes[1] === 0xff) {
            return new TextDecoder('utf-16be').decode(buffer);
        }
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        // Not valid UTF-8: a legacy single-byte encoding.
    }

    try {
        return chooseLegacySingleByteDecode(buffer);
    } catch {
        // Runtime without legacy decoders: non-fatal UTF-8 is the last resort.
        return new TextDecoder().decode(buffer);
    }
}

/**
 * Picks between the two dominant legacy encodings by the PLAUSIBILITY of the
 * Windows-1251 candidate, not a byte ratio (a ratio drowns short dialogue in
 * ASCII timing bytes one way, and over-weights accent-dense Latin words like
 * "Été" the other way). CP1251 maps every high letter byte into the Cyrillic
 * block, so a genuinely Cyrillic file decodes into pure-Cyrillic words, while
 * misread Latin text decodes into words that MIX Cyrillic and ASCII letters
 * ("était" → "йtait") — a shape real subtitles never contain.
 */
function chooseLegacySingleByteDecode(buffer: ArrayBuffer): string {
    const decoded1251 = new TextDecoder('windows-1251').decode(buffer);
    let cyrillicLetters = 0;
    let mixedLetters = 0;
    let asciiLetters = 0;
    for (const word of decoded1251.split(/[^\p{L}]+/u)) {
        if (!word) {
            continue;
        }
        if (!/[\u0400-\u04ff]/.test(word)) {
            asciiLetters += word.length;
        } else if (/[A-Za-z]/.test(word)) {
            mixedLetters += word.length;
        } else {
            cyrillicLetters += word.length;
        }
    }
    // Two guards: mixed-script words are strong evidence of misread Latin
    // text, and isolated accented CP1252 words ("\u00c0 table" \u2192 "\u0410 table")
    // masquerade as tiny pure-Cyrillic words \u2014 so Cyrillic must also carry a
    // meaningful share of all letters before 1251 wins. Genuinely Cyrillic
    // dialogue dominates its own letter count even with embedded Latin names.
    const plausiblyCyrillic =
        cyrillicLetters > mixedLetters * 2 &&
        cyrillicLetters * 4 > asciiLetters;
    return plausiblyCyrillic
        ? decoded1251
        : new TextDecoder('windows-1252').decode(buffer);
}

// SRT uses "00:00:01,500"; VTT uses "00:00:01.500" and allows a missing hour
// part ("01:23.456"). One pattern covers both.
const TIMESTAMP_PATTERN =
    /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;
const TIMING_LINE_PATTERN = new RegExp(
    `^\\s*(${TIMESTAMP_PATTERN.source})\\s*-->\\s*(${TIMESTAMP_PATTERN.source})`
);

function parseTimestamp(value: string): number | null {
    const match = TIMESTAMP_PATTERN.exec(value.trim());
    if (!match || match[0] !== value.trim()) {
        return null;
    }
    const hours = match[1] !== undefined ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(match[4].padEnd(3, '0'));
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function stripVttMarkup(text: string): string {
    // Remove inline cue timestamps ("karaoke" tags) but keep the text; the
    // browser renders remaining <i>/<b>-style tags itself inside VTTCue.
    return text.replace(/<\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}>/g, '');
}

/**
 * Parses SRT or VTT content into cues, skipping malformed blocks instead of
 * failing the whole file. Returns cues sorted by start time.
 */
export function parseExternalSubtitleCues(
    file: Pick<ExternalSubtitleFile, 'format' | 'content'>
): ParsedSubtitleCue[] {
    const lines = file.content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    const cues: ParsedSubtitleCue[] = [];

    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const timing = TIMING_LINE_PATTERN.exec(line);
        if (!timing) {
            index += 1;
            continue;
        }

        const startSeconds = parseTimestamp(timing[1]);
        const endSeconds = parseTimestamp(timing[6]);
        index += 1;

        const textLines: string[] = [];
        while (index < lines.length && lines[index].trim() !== '') {
            textLines.push(lines[index]);
            index += 1;
        }

        if (
            startSeconds === null ||
            endSeconds === null ||
            endSeconds <= startSeconds ||
            textLines.length === 0
        ) {
            continue;
        }

        cues.push({
            startSeconds,
            endSeconds,
            text: stripVttMarkup(textLines.join('\n')).trim(),
        });
    }

    return cues
        .filter((cue) => cue.text.length > 0)
        .sort((a, b) => a.startSeconds - b.startSeconds);
}
