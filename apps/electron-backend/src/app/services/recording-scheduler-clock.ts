export type RecordingTimerHandle = ReturnType<typeof setTimeout>;

export interface RecordingSchedulerClock {
    now(): Date;
    setTimeout(callback: () => void, delayMs: number): RecordingTimerHandle;
    clearTimeout(handle: RecordingTimerHandle): void;
}

export const systemRecordingSchedulerClock: RecordingSchedulerClock = {
    now: () => new Date(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
};
