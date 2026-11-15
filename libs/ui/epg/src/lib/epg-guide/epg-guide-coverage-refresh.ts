import type { EpgGuideChannel } from './epg-guide-source';

const REFRESH_BATCH = 12;
const REFRESH_INTERVAL_MS = 60_000;

export type CoverageCheck = { hasPrograms: boolean; expiresAt: number };

export const NO_PROGRAMMES: CoverageCheck = {
    hasPrograms: false,
    expiresAt: Infinity,
};

export interface CoverageScan {
    controller: AbortController;
    progress?: {
        confirmed: Set<string>;
        checks: Map<string, CoverageCheck>;
        timer?: ReturnType<typeof setTimeout>;
    };
}

export function changedCoverage(
    previous: CoverageCheck | undefined,
    hasPrograms: boolean,
    expiresAt: number
): CoverageCheck | undefined {
    if (
        previous?.hasPrograms !== hasPrograms ||
        previous.expiresAt !== expiresAt
    )
        return { hasPrograms, expiresAt };
    return undefined;
}

/** Limits background reads while giving later rows a turn in large scopes. */
export function createCoverageRefreshBudget(failed: ReadonlySet<string>) {
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
                if (
                    failed.has(channel.id) ||
                    (checks.get(channel.id)?.expiresAt ?? Infinity) <= nowMs
                )
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
