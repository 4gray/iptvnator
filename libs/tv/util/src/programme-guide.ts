import type { Program } from './index';

export interface GuideProgram extends Program {
    id: string;
    day: string;
}

/** Dates follow the TV's local timezone, including DST and overnight shows. */
export function programmeDay(timestamp: number) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function guidePrograms(programs: Program[]): GuideProgram[] {
    const seen = new Set<string>();
    return programs
        .filter((program) => {
            if (
                !Number.isFinite(program.start) ||
                !Number.isFinite(program.end) ||
                program.end <= program.start ||
                !Number.isFinite(new Date(program.start).getTime()) ||
                !Number.isFinite(new Date(program.end).getTime())
            )
                return false;
            const id = JSON.stringify([
                program.start,
                program.end,
                program.title,
            ]);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .map((program) => ({
            ...program,
            id: JSON.stringify([program.start, program.end, program.title]),
            day: programmeDay(program.start),
        }))
        .sort((a, b) => a.start - b.start);
}

/** A gap selects the next supplied show; a finished schedule selects its last. */
export function programmeNow<T extends Program>(programs: T[], now: number) {
    return (
        programs.find((program) => program.start <= now && program.end > now) ??
        programs.find((program) => program.start > now) ??
        programs[programs.length - 1]
    );
}

/** Retain the selected row so pointer scrolling cannot unmount keyboard focus. */
export function programmeWindow(
    length: number,
    scroll: number,
    selected: number
) {
    const start = Math.max(
        0,
        Math.min(Math.floor(scroll / 100) - 2, length - 20)
    );
    const indices = Array.from(
        { length: Math.min(20, Math.max(0, length - start)) },
        (_, index) => start + index
    );
    if (selected >= 0 && selected < length && !indices.includes(selected))
        indices.push(selected);
    return indices;
}
