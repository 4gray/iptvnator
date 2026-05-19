const EPOCH_MILLISECONDS_THRESHOLD = 10_000_000_000;

export const XTREAM_RECENTLY_ADDED_FUTURE_GRACE_MS = 24 * 60 * 60 * 1000;

function normalizeEpochNumber(value: number): number {
    return value >= EPOCH_MILLISECONDS_THRESHOLD ? value : value * 1000;
}

function parseTimestampMs(value: unknown): number {
    if (typeof value === 'number') {
        return normalizeEpochNumber(value);
    }

    if (typeof value !== 'string') {
        return 0;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return 0;
    }

    if (/^\d+$/.test(trimmed)) {
        return normalizeEpochNumber(Number(trimmed));
    }

    return 0;
}

export function toXtreamRecentlyAddedTimestamp(
    value: unknown,
    nowMs = Date.now()
): number {
    const timestampMs = parseTimestampMs(value);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
        return 0;
    }

    if (timestampMs > nowMs + XTREAM_RECENTLY_ADDED_FUTURE_GRACE_MS) {
        return 0;
    }

    return timestampMs;
}

export function toXtreamRecentlyAddedEpochSeconds(
    value: unknown,
    nowMs = Date.now()
): string {
    const timestampMs = toXtreamRecentlyAddedTimestamp(value, nowMs);
    return timestampMs > 0 ? String(Math.floor(timestampMs / 1000)) : '';
}

export function getXtreamRecentlyAddedMaxEpochSeconds(
    nowMs = Date.now()
): string {
    return String(
        Math.floor((nowMs + XTREAM_RECENTLY_ADDED_FUTURE_GRACE_MS) / 1000)
    );
}
