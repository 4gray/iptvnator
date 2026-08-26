import { format } from 'date-fns';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { EPG_DATE_KEY_FORMAT } from './epg-date';

export function getProgramTimeMs(
    isoValue: string,
    timestampValue?: number | null,
    offsetMinutes = 0
): number {
    const baseMs =
        Number.isFinite(timestampValue) && Number(timestampValue) > 0
            ? Number(timestampValue) * 1000
            : Date.parse(isoValue);
    return baseMs + offsetMinutes * 60_000;
}

export function getProgramDateKey(
    isoValue: string,
    timestampValue?: number | null,
    offsetMinutes = 0
): string {
    const programTimeMs = getProgramTimeMs(
        isoValue,
        timestampValue,
        offsetMinutes
    );

    if (!Number.isFinite(programTimeMs)) {
        return '';
    }

    return format(new Date(programTimeMs), EPG_DATE_KEY_FORMAT);
}

export function deduplicateProgramsByTimeSlot(
    programs: EpgProgram[],
    offsetMinutes = 0
): EpgProgram[] {
    const programsByTimeSlot = new Map<string, EpgProgram>();

    for (const program of programs) {
        const timeSlotKey = buildProgramTimeSlotKey(program, offsetMinutes);
        const existingProgram = programsByTimeSlot.get(timeSlotKey);

        programsByTimeSlot.set(
            timeSlotKey,
            existingProgram
                ? selectMoreInformativeProgram(existingProgram, program)
                : program
        );
    }

    return Array.from(programsByTimeSlot.values());
}

export function areProgramsSame(
    left: EpgProgram,
    right: EpgProgram,
    offsetMinutes = 0
): boolean {
    return (
        (left.channel ?? '') === (right.channel ?? '') &&
        getProgramTimeMs(left.start, left.startTimestamp, offsetMinutes) ===
            getProgramTimeMs(
                right.start,
                right.startTimestamp,
                offsetMinutes
            ) &&
        getProgramTimeMs(left.stop, left.stopTimestamp, offsetMinutes) ===
            getProgramTimeMs(right.stop, right.stopTimestamp, offsetMinutes)
    );
}

function buildProgramTimeSlotKey(
    program: EpgProgram,
    offsetMinutes: number
): string {
    return [
        getProgramTimeMs(program.start, program.startTimestamp, offsetMinutes),
        getProgramTimeMs(program.stop, program.stopTimestamp, offsetMinutes),
    ].join('|');
}

function selectMoreInformativeProgram(
    existingProgram: EpgProgram,
    candidateProgram: EpgProgram
): EpgProgram {
    return getProgramMetadataScore(candidateProgram) >
        getProgramMetadataScore(existingProgram)
        ? candidateProgram
        : existingProgram;
}

function getProgramMetadataScore(program: EpgProgram): number {
    return (
        getTextScore(program.desc) * 8 +
        getTextScore(program.category) * 4 +
        getTextScore(program.iconUrl) * 2 +
        getTextScore(program.rating) * 2 +
        getTextScore(program.episodeNum) * 2 +
        getTextScore(program.title)
    );
}

function getTextScore(value: string | null | undefined): number {
    return value?.trim() ? 1 : 0;
}
