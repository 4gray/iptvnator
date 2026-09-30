import type { EmbeddedMpvChapter } from '@iptvnator/shared/interfaces';

/**
 * Validate the addon's or helper's `chapters` snapshot field before it
 * reaches the renderer: an older binary omits it, and a malformed entry must
 * not draw a segment. Order is left to the renderer's timeline mapping.
 */
export function normalizeEmbeddedMpvChapters(
    value: unknown
): EmbeddedMpvChapter[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const chapters: EmbeddedMpvChapter[] = [];
    for (const entry of value) {
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
        const trimmedTitle = typeof title === 'string' ? title.trim() : '';
        chapters.push(
            trimmedTitle ? { timeSeconds, title: trimmedTitle } : { timeSeconds }
        );
    }
    return chapters;
}
