import type {
    PlaybackPositionData,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
export interface RemainingTimeLabel {
    readonly key: string;
    readonly params: Record<string, number>;
}

interface ProgressPosition {
    positionSeconds: number;
    durationSeconds?: number;
}

/** 0–100 watched share, or null when the duration is unknown. */
/** The position row an inline player's time update writes for its content. */
export function inlineProgressPosition(
    contentInfo: PlayerContentInfo,
    event: { currentTime: number; duration: number }
): PlaybackPositionData {
    return {
        ...contentInfo,
        positionSeconds: Math.floor(event.currentTime),
        durationSeconds: Math.floor(event.duration),
    };
}

export function playbackProgressPercent(
    position: ProgressPosition | null | undefined
): number | null {
    if (
        !position ||
        position.durationSeconds == null ||
        position.durationSeconds <= 0
    ) {
        return null;
    }
    const ratio = position.positionSeconds / position.durationSeconds;
    if (!Number.isFinite(ratio)) {
        return null;
    }
    // Integer percent keeps "92% watched" out of "92.4% watched" territory,
    // and matches the resolution of a 3px-tall progress bar.
    return Math.max(0, Math.min(100, Math.floor(ratio * 100)));
}

/** "22m left" / "1h 5m left" as an i18n key with parameters. */
export function formatRemainingLabel(
    position: ProgressPosition | null | undefined
): RemainingTimeLabel | null {
    if (
        !position ||
        position.durationSeconds == null ||
        position.durationSeconds <= 0
    ) {
        return null;
    }
    const remaining = Math.max(
        0,
        Math.round(position.durationSeconds - position.positionSeconds)
    );
    if (remaining < 60) {
        return {
            key: 'WORKSPACE.DASHBOARD.REMAINING_SECONDS',
            params: { seconds: remaining },
        };
    }
    const totalMinutes = Math.round(remaining / 60);
    if (totalMinutes < 60) {
        return {
            key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
            params: { minutes: totalMinutes },
        };
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 0) {
        return {
            key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS',
            params: { hours },
        };
    }
    return {
        key: 'WORKSPACE.DASHBOARD.REMAINING_HOURS_MINUTES',
        params: { hours, minutes },
    };
}

/** "1 h 52 min" / "48 min" as an i18n key with parameters. */
export function formatDurationLabel(
    totalSeconds: number | null | undefined
): RemainingTimeLabel | null {
    if (!totalSeconds || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return null;
    }
    const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) {
        return { key: 'PORTALS.DETAIL.DURATION_MINUTES', params: { minutes } };
    }
    return {
        key: 'PORTALS.DETAIL.DURATION_HOURS_MINUTES',
        params: { hours, minutes },
    };
}

/**
 * Seconds from the duration strings providers send: "45 min", "1h 30min",
 * "01:52:10", "52:10", a bare number of seconds.
 */
export function parseDurationSeconds(
    duration: string | number | null | undefined
): number {
    if (!duration) {
        return 0;
    }
    if (typeof duration === 'number') {
        return duration;
    }
    // "45 min" (Stalker VOD) and "1h 30min" (Xtream): keep the hour part.
    const minutesMatch = duration.match(/(?:(\d+)\s*h\w*)?\s*(\d+)\s*min/);
    if (minutesMatch) {
        return (
            parseInt(minutesMatch[1] ?? '0', 10) * 3600 +
            parseInt(minutesMatch[2], 10) * 60
        );
    }
    const parts = duration.split(':').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2 && parts.every(Number.isFinite)) {
        return parts[0] * 60 + parts[1];
    }
    return Number(duration) || 0;
}
