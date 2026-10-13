import type { EmbeddedMpvChapter } from '@iptvnator/shared/interfaces';

/**
 * Every session update repeats the list, so a chapter-heavy file must not
 * inflate each IPC payload; the native parsers apply the same bounds.
 */
export const MAX_EMBEDDED_MPV_CHAPTERS = 256;
export const MAX_EMBEDDED_MPV_CHAPTER_TITLE_LENGTH = 256;

/**
 * Validate the addon's or helper's `chapters` snapshot field before it
 * reaches the renderer: an older binary omits it, and a malformed entry must
 * not draw a segment; the list and each title are bounded. Order is left to the renderer's timeline mapping.
 */
export function normalizeEmbeddedMpvChapters(
    value: unknown
): EmbeddedMpvChapter[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const chapters: EmbeddedMpvChapter[] = [];
    for (const entry of value) {
        if (chapters.length >= MAX_EMBEDDED_MPV_CHAPTERS) {
            break;
        }
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const { timeSeconds, title } = entry as Record<string, unknown>;
        if (
            typeof timeSeconds !== 'number' ||
            !Number.isFinite(timeSeconds) ||
            timeSeconds < 0
        ) {
            continue;
        }
        const trimmedTitle =
            typeof title === 'string'
                ? Array.from(title.trim())
                      .slice(0, MAX_EMBEDDED_MPV_CHAPTER_TITLE_LENGTH)
                      .join('')
                      .trim()
                : '';
        chapters.push(
            trimmedTitle
                ? { timeSeconds, title: trimmedTitle }
                : { timeSeconds }
        );
    }
    return chapters;
}
