import type { EpgProgram } from '@iptvnator/shared/interfaces';

export interface EpgRecordingRequestEvent {
    program: EpgProgram;
    scheduledStartAt: string;
    scheduledEndAt: string;
}

export function canScheduleEpgRecording(
    available: boolean,
    futureAvailable: boolean,
    when: 'past' | 'now' | 'future'
): boolean {
    return (
        available && (when === 'now' || (when === 'future' && futureAvailable))
    );
}

export function createEpgRecordingRequestEvent(
    program: EpgProgram,
    startMs: number,
    stopMs: number
): EpgRecordingRequestEvent {
    return {
        program,
        scheduledStartAt: new Date(startMs).toISOString(),
        scheduledEndAt: new Date(stopMs).toISOString(),
    };
}
