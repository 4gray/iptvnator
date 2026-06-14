import type { GlobalRecentItem } from '@iptvnator/workspace/dashboard/data-access';

export interface DashboardRemainingLabel {
    readonly key: string;
    readonly params: Record<string, number>;
}

export function buildPlaybackPositionReloadKey(
    items: readonly Pick<
        GlobalRecentItem,
        'playlist_id' | 'type' | 'xtream_id'
    >[]
): string {
    return items
        .filter((item) => item.type === 'movie' || item.type === 'series')
        .map((item) => `${item.playlist_id}::${item.type}::${item.xtream_id}`)
        .sort()
        .join('|');
}

export function isContinueWatchingRecentItem(
    item: Pick<GlobalRecentItem, 'type'>
): boolean {
    return item.type === 'movie' || item.type === 'series';
}

export function playbackProgressPercent(
    position: { positionSeconds: number; durationSeconds?: number } | null
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
    // and matches the resolution of a 3px-tall progress bar on a 280px card.
    return Math.max(0, Math.min(100, Math.floor(ratio * 100)));
}

export function formatRemainingLabel(
    position: { positionSeconds: number; durationSeconds?: number } | null
): DashboardRemainingLabel | null {
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
