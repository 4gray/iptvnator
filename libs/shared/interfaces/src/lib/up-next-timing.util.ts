/**
 * When the "Up next" card appears, shared by every client (desktop and web
 * player controls, and the TV client) so they all agree on the moment.
 *
 * Sources, first match wins:
 * 1. A known credits start supplied by the caller (for example TheIntroDB
 *    credits times, #2239). This is the hook a metadata source plugs into.
 * 2. A closing-credits chapter in the file.
 * 3. The adaptive lead: 4% of the episode, clamped to 40 s … 3 min.
 */

/** Share of the episode's length the card is shown for. */
export const UP_NEXT_THRESHOLD_RATIO = 0.04;
/** Bounds of the adaptive lead: long enough to read, short enough not to nag. */
export const UP_NEXT_MIN_THRESHOLD_SECONDS = 40;
export const UP_NEXT_MAX_THRESHOLD_SECONDS = 3 * 60;
/** Long credits still bring the card no further forward than this. */
export const UP_NEXT_MAX_CREDITS_LEAD_SECONDS = 5 * 60;
/**
 * How long the full card shows before it shrinks to a pill, on every client,
 * so it does not cover the credits for minutes.
 */
export const UP_NEXT_COLLAPSE_DELAY_MS = 10_000;
/** A credits chapter only counts in the episode's last third. */
const CREDITS_CHAPTER_MIN_RATIO = 2 / 3;
const CREDITS_CHAPTER_TITLE =
    /\bcredits?\b|\boutro\b|\bending\b|титры|abspann|générique|genérico|créditos|crediti|napisy/i;
/** Anime chapter lists mark the ending theme as `ED` / `ED1`. */
const ENDING_THEME_TITLE = /^\s*ED\d*\s*$/;

/** The parts of a chapter the timing needs. */
export interface UpNextChapter {
    startSeconds: number;
    title: string | null;
}

export interface UpNextTimingInput {
    /** The episode's length; the card needs a finite, positive one. */
    durationSeconds: number | null | undefined;
    /** The file's chapters, when the engine reports them. */
    chapters?: readonly UpNextChapter[] | null;
    /**
     * Where the closing credits start, from a metadata source. Wins over
     * chapters when it falls inside the episode.
     */
    creditsStartSeconds?: number | null;
}

/**
 * Seconds before the end at which the card appears: 4% of the episode,
 * clamped to 40 s … 3 min, so a 22-minute sitcom gets under a minute and an
 * hour-long drama a little over two.
 */
export function upNextThresholdSeconds(durationSeconds: number): number {
    return Math.min(
        UP_NEXT_MAX_THRESHOLD_SECONDS,
        Math.max(
            UP_NEXT_MIN_THRESHOLD_SECONDS,
            Math.round(durationSeconds * UP_NEXT_THRESHOLD_RATIO)
        )
    );
}

/**
 * Where the closing credits start, when the file's chapters name them.
 * Only chapters in the last third count, so an opening "Credits" chapter
 * never brings the card forward.
 */
export function creditsStartSeconds(
    chapters: readonly UpNextChapter[] | null | undefined,
    durationSeconds: number
): number | null {
    const earliest = durationSeconds * CREDITS_CHAPTER_MIN_RATIO;
    let start: number | null = null;
    for (const chapter of chapters ?? []) {
        if (
            chapter.title &&
            (CREDITS_CHAPTER_TITLE.test(chapter.title) ||
                ENDING_THEME_TITLE.test(chapter.title)) &&
            chapter.startSeconds >= earliest &&
            chapter.startSeconds < durationSeconds &&
            (start === null || chapter.startSeconds < start)
        ) {
            start = chapter.startSeconds;
        }
    }
    return start;
}

/**
 * Remaining time at which the card appears for this episode, or null when
 * the episode has no usable length (live streams, open-ended VOD).
 */
export function upNextLeadSeconds(input: UpNextTimingInput): number | null {
    const duration = input.durationSeconds;
    if (
        typeof duration !== 'number' ||
        !Number.isFinite(duration) ||
        duration <= 0
    ) {
        return null;
    }
    const supplied = input.creditsStartSeconds;
    const credits =
        typeof supplied === 'number' &&
        Number.isFinite(supplied) &&
        supplied > 0 &&
        supplied < duration
            ? supplied
            : creditsStartSeconds(input.chapters, duration);
    return credits !== null
        ? Math.min(duration - credits, UP_NEXT_MAX_CREDITS_LEAD_SECONDS)
        : upNextThresholdSeconds(duration);
}
