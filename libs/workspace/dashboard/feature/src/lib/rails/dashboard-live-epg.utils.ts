import type {
    DashboardRailsSettings,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import type { DashboardRailCard } from './dashboard-rail.component';

// EPG "now" data ticks every 30s: short enough that the progress bar moves
// visibly between long-tail program changes, long enough that we don't hammer
// the SQLite backend with a batched IPC every animation frame.
export const LIVE_EPG_TICK_MS = 30_000;

// Reads either an ISO `start`/`stop` or the pre-computed `startTimestamp`
// when present. The parsed XMLTV pipeline populates both, but legacy rows
// only carry the strings.
function epgTimestampMs(
    program: EpgProgram,
    side: 'start' | 'stop'
): number | null {
    const cached =
        side === 'start' ? program.startTimestamp : program.stopTimestamp;
    if (cached != null) {
        return cached;
    }
    const iso = side === 'start' ? program.start : program.stop;
    const ms = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
}

function formatEpgTime(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
}

export function formatEpgTimeRange(program: EpgProgram): string | null {
    const start = epgTimestampMs(program, 'start');
    const stop = epgTimestampMs(program, 'stop');
    if (start == null || stop == null) {
        return null;
    }
    return `${formatEpgTime(start)} – ${formatEpgTime(stop)}`;
}

export function calcEpgProgress(
    program: EpgProgram,
    nowMs: number
): number | null {
    const start = epgTimestampMs(program, 'start');
    const stop = epgTimestampMs(program, 'stop');
    if (start == null || stop == null || stop <= start) {
        return null;
    }
    const ratio = (nowMs - start) / (stop - start);
    if (!Number.isFinite(ratio)) {
        return null;
    }
    return Math.max(0, Math.min(100, ratio * 100));
}

export interface DashboardLiveEpgDetails {
    readonly nowPlayingTitle: string | null;
    readonly nowPlayingTimeRange: string | null;
    readonly nowPlayingProgress: number | null;
}

export function buildDashboardLiveEpgDetails(
    program: EpgProgram | null,
    nowMs: number
): DashboardLiveEpgDetails | null {
    if (!program) {
        return null;
    }

    const details: DashboardLiveEpgDetails = {
        nowPlayingTitle: program.title?.trim() || null,
        nowPlayingTimeRange: formatEpgTimeRange(program),
        nowPlayingProgress: calcEpgProgress(program, nowMs),
    };

    return details.nowPlayingTitle ||
        details.nowPlayingTimeRange ||
        details.nowPlayingProgress !== null
        ? details
        : null;
}

function liveEpgLookupKeyForCard(card: DashboardRailCard): string {
    return card.epgLookupKey?.trim() || card.title.trim();
}

export function buildLiveEpgLookupKeys(
    cards: readonly DashboardRailCard[]
): string[] {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const card of cards) {
        const key = liveEpgLookupKeyForCard(card);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    return keys;
}

type DashboardLiveEpgRailSettings = Pick<
    DashboardRailsSettings,
    'hero' | 'liveFavorites' | 'recentlyWatchedLive'
>;

export function buildLiveEpgCardsForEnabledRails(
    rails: DashboardLiveEpgRailSettings,
    heroLiveCard: DashboardRailCard | null,
    liveFavoriteCards: readonly DashboardRailCard[],
    recentLiveCards: readonly DashboardRailCard[]
): DashboardRailCard[] {
    return [
        ...(rails.hero && heroLiveCard ? [heroLiveCard] : []),
        ...(rails.liveFavorites ? liveFavoriteCards : []),
        ...(rails.recentlyWatchedLive ? recentLiveCards : []),
    ];
}

export function getLiveEpgProgramForCard(
    card: DashboardRailCard,
    epgMap: ReadonlyMap<string, EpgProgram | null>
): EpgProgram | null {
    const key = liveEpgLookupKeyForCard(card);
    const program = epgMap.get(key);
    if (program) {
        return program;
    }

    const titleKey = card.title.trim();
    return key !== titleKey ? (epgMap.get(titleKey) ?? null) : null;
}
