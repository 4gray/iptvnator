import type { EpgGuideChannel } from './epg-guide-source';

const REFRESH_BATCH = 12;
const REFRESH_INTERVAL_MS = 60_000;

/** Limits background reads while giving later rows a turn in large scopes. */
export function createCoverageRefreshBudget() {
    let refreshAt = 0;
    let cursor = 0;
    return {
        collect(
            nowMs: number,
            channels: readonly EpgGuideChannel[],
            checks: ReadonlyMap<string, { expiresAt: number }>
        ): EpgGuideChannel[] {
            const expired: EpgGuideChannel[] = [];
            if (nowMs < refreshAt) return expired;
            for (
                let left = channels.length;
                left && expired.length < REFRESH_BATCH;
                left--
            ) {
                const index = cursor % channels.length;
                cursor = index + 1;
                const channel = channels[index];
                if ((checks.get(channel.id)?.expiresAt ?? Infinity) <= nowMs)
                    expired.push(channel);
            }
            if (expired.length) refreshAt = nowMs + REFRESH_INTERVAL_MS;
            return expired;
        },
        reset() {
            refreshAt = cursor = 0;
        },
    };
}
