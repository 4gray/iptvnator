import { format } from 'date-fns';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { EPG_DATE_KEY_FORMAT } from './epg-date';

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
