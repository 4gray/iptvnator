import type { BackgroundMetadataWarmupSchedule } from './settings.interface';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function getBackgroundMetadataWarmupIntervalMs(
    schedule: BackgroundMetadataWarmupSchedule
): number | null {
    switch (schedule) {
        case 'weekly':
            return WEEK_MS;
        case 'monthly':
            return MONTH_MS;
        case 'every-opening':
        default:
            return null;
    }
}

export function getBackgroundMetadataFreshnessCutoff(
    schedule: BackgroundMetadataWarmupSchedule,
    now = Date.now()
): number | null {
    const intervalMs = getBackgroundMetadataWarmupIntervalMs(schedule);
    return intervalMs === null ? null : now - intervalMs;
}

export function isMediaMetadataDueForSchedule(
    hasMetadata: boolean,
    metadataUpdatedAt: unknown,
    schedule: BackgroundMetadataWarmupSchedule,
    now = Date.now()
): boolean {
    if (!hasMetadata) {
        return true;
    }

    const cutoff = getBackgroundMetadataFreshnessCutoff(schedule, now);
    if (cutoff === null) {
        return false;
    }

    const updatedAt = Number(metadataUpdatedAt);
    return !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt < cutoff;
}
