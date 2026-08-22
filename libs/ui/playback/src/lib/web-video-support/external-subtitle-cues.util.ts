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
