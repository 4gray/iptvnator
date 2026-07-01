import { EpgProgram } from '@iptvnator/shared/interfaces';
import { addDays } from 'date-fns';
import { parseEpgDateKey } from '../epg-date';
import {
    areProgramsSame,
    deduplicateProgramsByTimeSlot,
    getProgramTimeMs,
} from '../epg-list/epg-list.utils';
import { canCatchUpProgramme } from '../epg-timeline/epg-archive.util';
import {
    classifyTimelineWhen,
    TimelineWhen,
} from '../epg-timeline/epg-timeline.utils';

/**
 * One vertical list row. View-agnostic classification/gating is precomputed so
 * the row component stays dumb and the list re-derives everything off the 30s
 * `nowMs` tick. Mirrors the timeline's `TimelineBlock` semantics without the
 * ribbon geometry (offset/duration in px).
 */
export interface EpgListRow {
    readonly program: EpgProgram;
    readonly key: string;
    readonly startMs: number;
    readonly stopMs: number;
    readonly when: TimelineWhen;
    /** Live progress 0–100 for the `now` row, else null. */
    readonly progress: number | null;
    /** Matches the host's active programme (archive playback highlight). */
    readonly isActive: boolean;
    /** Past programme playable from the catch-up archive. */
    readonly canCatchUp: boolean;
}

export interface BuildEpgListRowsOptions {
    readonly archivePlaybackAvailable: boolean;
    readonly archiveDays: number;
    readonly activeProgram: EpgProgram | null;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

function liveProgress(
    when: TimelineWhen,
    startMs: number,
    stopMs: number,
    nowMs: number
): number | null {
    if (when !== 'now' || stopMs <= startMs) {
        return null;
    }
    return clampPercent(((nowMs - startMs) / (stopMs - startMs)) * 100);
}

/**
 * Programmes overlapping the given local day, sorted by start and deduplicated.
 * Overlap-based (not start-date-only) so a cross-midnight programme airing now
 * still shows for *today* — matching `hasProgramsForDateKey`, which the list's
 * render-state uses. A start-date filter would drop the on-air programme and
 * leave an empty list while the state says `list`.
 */
export function buildEpgListRows(
    programs: readonly EpgProgram[],
    selectedDateKey: string,
    nowMs: number,
    options: BuildEpgListRowsOptions
): EpgListRow[] {
    const dayStart = parseEpgDateKey(selectedDateKey);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = addDays(dayStart, 1).getTime(); // exclusive

    const forDay = programs.filter((program) => {
        const startMs = getProgramTimeMs(program.start, program.startTimestamp);
        const stopMs = getProgramTimeMs(program.stop, program.stopTimestamp);
        if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) {
            return false;
        }
        return startMs < dayEndMs && stopMs > dayStartMs;
    });

    const deduped = deduplicateProgramsByTimeSlot(
        [...forDay].sort(
            (left, right) =>
                getProgramTimeMs(left.start, left.startTimestamp) -
                getProgramTimeMs(right.start, right.startTimestamp)
        )
    );

    const activeProgram = options.activeProgram;

    return deduped.map((program, index) => {
        const startMs = getProgramTimeMs(program.start, program.startTimestamp);
        const stopMs = getProgramTimeMs(program.stop, program.stopTimestamp);
        const when = classifyTimelineWhen(startMs, stopMs, nowMs);

        return {
            program,
            key: `${startMs}-${stopMs}-${index}`,
            startMs,
            stopMs,
            when,
            progress: liveProgress(when, startMs, stopMs, nowMs),
            isActive: activeProgram
                ? areProgramsSame(program, activeProgram)
                : false,
            canCatchUp: canCatchUpProgramme(
                when,
                startMs,
                options.archivePlaybackAvailable,
                options.archiveDays,
                nowMs
            ),
        };
    });
}
