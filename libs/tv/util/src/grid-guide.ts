import { clipGuideSpan, TimelineAxis } from '@iptvnator/shared/epg';
import type { GuideProgram } from './programme-guide';
export const GUIDE_HOUR = 3600000;
export const GUIDE_SPAN = 2 * GUIDE_HOUR;
export function guideWindow(time: number): TimelineAxis {
    // Align in local time, including zones whose offset is not a whole hour.
    const date = new Date(time);
    const startMs =
        time -
        (date.getMinutes() % 30) * 60000 -
        date.getSeconds() * 1000 -
        date.getMilliseconds();
    return { startMs, endMs: startMs + GUIDE_SPAN };
}
export function gridProgramAt(
    programs: GuideProgram[],
    axis: TimelineAxis,
    time: number
) {
    const visible = programs.filter((p) => clipGuideSpan(axis, p.start, p.end));
    return (
        visible.find((p) => p.start <= time && p.end > time) ??
        visible.reduce<GuideProgram | undefined>(
            (nearest, p) =>
                !nearest ||
                Math.abs(p.start - time) < Math.abs(nearest.start - time)
                    ? p
                    : nearest,
            undefined
        )
    );
}
export function gridVisiblePrograms(
    programs: GuideProgram[],
    axis: TimelineAxis,
    selected: string
) {
    const visible = programs.filter((p) => clipGuideSpan(axis, p.start, p.end));
    const window = visible.slice(0, 64);
    const active = visible.find((p) => p.id === selected);
    if (active && !window.includes(active)) window.push(active);
    return window;
}
export const gridTime = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
