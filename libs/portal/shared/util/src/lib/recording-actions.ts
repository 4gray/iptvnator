import { InjectionToken } from '@angular/core';
import type {
    ScheduleRecordingRequest,
    ScheduleRecordingResult,
} from '@iptvnator/shared/interfaces';

export interface RecordingActions {
    readonly isAvailable: () => boolean;
    schedule(
        request: ScheduleRecordingRequest
    ): Promise<ScheduleRecordingResult>;
}

export const RECORDING_ACTIONS = new InjectionToken<RecordingActions>(
    'RECORDING_ACTIONS'
);
