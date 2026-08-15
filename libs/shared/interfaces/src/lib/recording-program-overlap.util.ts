import type { RecordingProgramSnapshot } from './recording-metadata.interface';

/**
 * Normalizes the hosts' program shapes (XMLTV `EpgProgram.desc`, Xtream
 * `EpgItem.description`) into the recording snapshot form.
 */
export function toRecordingProgramSnapshot(program: {
    title: string;
    desc?: string | null;
    description?: string | null;
    start: string;
    stop: string;
}): RecordingProgramSnapshot {
    const description = (program.description ?? program.desc ?? '').trim();
    return {
        title: program.title,
        ...(description ? { description } : {}),
        start: program.start,
        stop: program.stop,
    };
}

/**
 * Filters normalized program snapshots to the ones overlapping the recorded
 * interval, sorted by start. Used by the live hosts' stop-enrichment
 * handlers, so a recording spanning a program boundary reports every covered
 * program. Fails closed: an unknown recording start yields an empty list
 * (the start snapshot then stands).
 */
export function filterRecordingProgramsOverlap(
    programs: readonly RecordingProgramSnapshot[],
    startedAt: string | null,
    endedAt: string
): RecordingProgramSnapshot[] {
    if (!startedAt) {
        return [];
    }
    const windowStart = Date.parse(startedAt);
    const windowEnd = Date.parse(endedAt);
    if (
        !Number.isFinite(windowStart) ||
        !Number.isFinite(windowEnd) ||
        windowEnd <= windowStart
    ) {
        return [];
    }

    return programs
        .map((program) => ({
            program,
            start: Date.parse(program.start),
            stop: Date.parse(program.stop),
        }))
        .filter(
            ({ start, stop }) =>
                Number.isFinite(start) &&
                Number.isFinite(stop) &&
                start < windowEnd &&
                stop > windowStart
        )
        .sort((a, b) => a.start - b.start)
        .map(({ program }) => program);
}
