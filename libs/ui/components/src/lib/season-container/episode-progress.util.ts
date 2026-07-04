import { isPortalPlaybackWatched } from '@iptvnator/portal/shared/util';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';

/** Pure helpers for episode duration parsing and progress-text formatting. */

export function parseDuration(duration: string | number | undefined): number {
    if (!duration) {
        return 0;
    }

    if (typeof duration === 'number') {
        return duration;
    }

    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }

    return Number(duration) || 0;
}

/**
 * Human-readable in-progress text ("41:12 left" / elapsed time when the
 * duration is unknown). Returns null for watched or position-less episodes.
 */
export function formatEpisodePositionText(
    position: PlaybackPositionData | undefined
): string | null {
    if (isPortalPlaybackWatched(position)) {
        return null;
    }

    if (!position || !position.positionSeconds) {
        return null;
    }

    let seconds = position.positionSeconds;
    let suffix = '';

    if (position.durationSeconds && position.durationSeconds > 0) {
        const remaining = Math.max(
            0,
            position.durationSeconds - position.positionSeconds
        );

        if (remaining <= 0) {
            return null;
        }

        seconds = remaining;
        suffix = ' left';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const formatted = [hours, minutes, secs]
        .map((value) => String(value).padStart(2, '0'))
        .filter((value, index) => (index === 0 ? value !== '00' : true))
        .join(':');
    return `${formatted}${suffix}`;
}
