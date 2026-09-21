import { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';

/**
 * Selection rules for the "current program" line under a channel row, kept
 * out of the component so both the scroll-driven fill and the periodic
 * refresh (#767) read the guide the same way.
 *
 * Every comparison here takes an explicit `nowMs` in the PROVIDER's clock
 * (`epgProviderClockMs`), never `Date.now()` — the EPG display offset moves
 * "now", not the programmes.
 *
 * A programme occupies `[start, stop)`: at exactly its stop time it is over
 * and its successor has begun. One rule for every function below, so the
 * "has it ended" and "what is on air" answers cannot disagree on the
 * boundary and leave the row a minute behind the rest of the EPG surfaces.
 */

/**
 * Milliseconds for one guide boundary. The provider's unix timestamp wins
 * when it is present; the ISO string is the fallback. `NaN` when neither
 * form parses, so callers must check before comparing.
 */
export function epgBoundaryMs(
    dateValue: string | undefined,
    unixTimestampValue: string | undefined
): number {
    const unixTimestamp = Number(unixTimestampValue);
    if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
        return unixTimestamp * 1000;
    }

    return new Date(dateValue ?? '').getTime();
}

/** Same boundary in whole seconds, or `null` when neither form parses. */
export function epgBoundarySeconds(
    dateValue: string | undefined,
    unixTimestampValue: string | undefined
): number | null {
    const boundaryMs = epgBoundaryMs(dateValue, unixTimestampValue);
    return Number.isFinite(boundaryMs) ? Math.floor(boundaryMs / 1000) : null;
}

function epgItemStartMs(item: EpgItem): number {
    return epgBoundaryMs(item.start, item.start_timestamp);
}

function epgItemEndMs(item: EpgItem): number {
    return epgBoundaryMs(item.stop ?? item.end, item.stop_timestamp);
}

/**
 * The programme on air at `nowMs`, else the next one to start.
 *
 * `null` when every item has already ended: a finished programme must never
 * be presented as the current one, which is the whole point of the periodic
 * refresh. Returning the newest ended item instead would be just as wrong —
 * the row would still name a programme that is over.
 */
export function pickAiringOrUpcomingEpgItem(
    items: readonly EpgItem[],
    nowMs: number
): EpgItem | null {
    if (items.length === 0) {
        return null;
    }

    const byStart = [...items].sort(
        (left, right) => epgItemStartMs(left) - epgItemStartMs(right)
    );

    const airing = byStart.find(
        (item) => nowMs >= epgItemStartMs(item) && nowMs < epgItemEndMs(item)
    );

    return (
        airing ?? byStart.find((item) => epgItemStartMs(item) > nowMs) ?? null
    );
}

/**
 * The programme to show for a row that has none yet. Falls back to the
 * earliest known item so a first paint shows what the guide holds rather
 * than an empty line; the refresh path deliberately does NOT use this
 * fallback, because re-applying it to a row that already advanced could
 * move it backwards to an older programme.
 */
export function pickEpgPreviewItem(
    items: readonly EpgItem[],
    nowMs: number
): EpgItem | null {
    if (items.length === 0) {
        return null;
    }

    const airingOrUpcoming = pickAiringOrUpcomingEpgItem(items, nowMs);
    if (airingOrUpcoming) {
        return airingOrUpcoming;
    }

    return [...items].sort(
        (left, right) => epgItemStartMs(left) - epgItemStartMs(right)
    )[0];
}

function epgProgramStartMs(program: EpgProgram): number {
    return program.startTimestamp != null
        ? program.startTimestamp * 1000
        : new Date(program.start ?? '').getTime();
}

function epgProgramEndMs(program: EpgProgram): number {
    return program.stopTimestamp != null
        ? program.stopTimestamp * 1000
        : new Date(program.stop ?? '').getTime();
}

/**
 * Whether the programme already on screen has run out.
 *
 * An unreadable end time answers `false`: the row keeps what it has instead
 * of asking the provider for a replacement once a minute, forever.
 */
export function hasEpgProgramEnded(
    program: EpgProgram,
    nowMs: number
): boolean {
    const endMs = epgProgramEndMs(program);
    return Number.isFinite(endMs) ? endMs <= nowMs : false;
}

/** Elapsed percentage, or `null` while `nowMs` sits outside the programme. */
export function epgProgramProgressPercent(
    program: EpgProgram,
    nowMs: number
): number | null {
    const startMs = epgProgramStartMs(program);
    const endMs = epgProgramEndMs(program);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return null;
    }

    if (nowMs < startMs || nowMs >= endMs) {
        return null;
    }

    return ((nowMs - startMs) / (endMs - startMs)) * 100;
}

/** Guide item in the shape the shared channel-row components render. */
export function toSharedEpgProgram(program: EpgItem): EpgProgram {
    return {
        start: program.start,
        stop: program.stop ?? program.end,
        channel: program.channel_id ?? program.id,
        title: program.title,
        desc: program.description ?? null,
        category: null,
        startTimestamp: epgBoundarySeconds(
            program.start,
            program.start_timestamp
        ),
        stopTimestamp: epgBoundarySeconds(
            program.stop ?? program.end,
            program.stop_timestamp
        ),
    };
}
