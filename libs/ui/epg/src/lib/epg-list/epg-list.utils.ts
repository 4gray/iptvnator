import { format } from 'date-fns';
import type { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import { EPG_DATE_KEY_FORMAT } from '../epg-date';

export function trackProgram(index: number, program: EpgProgram): string {
    const start = getProgramTimeMs(program.start, program.startTimestamp);
    const stop = getProgramTimeMs(program.stop, program.stopTimestamp);

    return [
        program.channel ?? '',
        Number.isFinite(start) ? start : program.start,
        Number.isFinite(stop) ? stop : program.stop,
        program.title ?? '',
        index,
    ].join('|');
}

export function buildScrollContextKey(
    channel: Channel | null,
    programs: EpgProgram[]
): string | null {
    if (!channel && programs.length === 0) {
        return null;
    }

    const channelKey =
        channel?.tvg?.id || channel?.name || channel?.url || 'unknown-channel';
    const programKey = programs
        .map(
            (program) =>
                `${getProgramTimeMs(program.start, program.startTimestamp)}-${getProgramTimeMs(program.stop, program.stopTimestamp)}`
        )
        .join('|');

    return `${channelKey}:${programKey}`;
}

export function getProgramTimeMs(
    isoValue: string,
    timestampValue?: number | null
): number {
    if (Number.isFinite(timestampValue) && Number(timestampValue) > 0) {
        return Number(timestampValue) * 1000;
    }

    return Date.parse(isoValue);
}

export function getProgramDateKey(
    isoValue: string,
    timestampValue?: number | null
): string {
    const programTimeMs = getProgramTimeMs(isoValue, timestampValue);

    if (!Number.isFinite(programTimeMs)) {
        return '';
    }

    return format(new Date(programTimeMs), EPG_DATE_KEY_FORMAT);
}

export function areProgramsSame(
    left: EpgProgram,
    right: EpgProgram
): boolean {
    return (
        (left.channel ?? '') === (right.channel ?? '') &&
        getProgramTimeMs(left.start, left.startTimestamp) ===
            getProgramTimeMs(right.start, right.startTimestamp) &&
        getProgramTimeMs(left.stop, left.stopTimestamp) ===
            getProgramTimeMs(right.stop, right.stopTimestamp)
    );
}
