import {
    epgDisplayTimeMs,
    epgProviderClockMs,
    type DashboardRailsSettings,
    type EpgProgram,
} from '@iptvnator/shared/interfaces';
import type { DashboardRailCard } from './dashboard-rail.component';

// EPG "now" data ticks every 30s: short enough that the progress bar moves
// visibly between long-tail program changes, long enough that we don't hammer
// the SQLite backend with a batched IPC every animation frame.
export const LIVE_EPG_TICK_MS = 30_000;

// A programme still on air is asked for again at least this often: a guide
// refreshed outside this page's view can correct or replace it, and nothing
// else tells the dashboard.
export const LIVE_EPG_MAX_ANSWER_AGE_MS = 5 * 60_000;

// Reads either an ISO `start`/`stop` or the pre-computed `startTimestamp`
// when present. The parsed XMLTV pipeline populates both, but legacy rows
// only carry the strings. `startTimestamp`/`stopTimestamp` are unix SECONDS
// (the same contract `getProgramTimeMs` in `@iptvnator/ui/epg` reads), so a
// usable value is scaled to milliseconds; zero, negative or non-finite
// values are treated as absent and fall back to the ISO string.
function epgTimestampMs(
    program: EpgProgram,
    side: 'start' | 'stop'
): number | null {
    const cached =
        side === 'start' ? program.startTimestamp : program.stopTimestamp;
    if (Number.isFinite(cached) && Number(cached) > 0) {
        return Number(cached) * 1000;
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

/** "HH:mm – HH:mm" in display time (raw times + the EPG display offset). */
export function formatEpgTimeRange(
    program: EpgProgram,
    offsetMinutes = 0
): string | null {
    const start = epgTimestampMs(program, 'start');
    const stop = epgTimestampMs(program, 'stop');
    if (start == null || stop == null) {
        return null;
    }
    return `${formatEpgTime(epgDisplayTimeMs(start, offsetMinutes))} – ${formatEpgTime(
        epgDisplayTimeMs(stop, offsetMinutes)
    )}`;
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
    /** Programme synopsis; set only when the guide has one (hero slide). */
    readonly nowPlayingDescription?: string;
    /** Guide category ("Sport"); set only when the guide has one. */
    readonly nowPlayingCategory?: string;
}

/**
 * `nowMs` is wall-clock; `offsetMinutes` is the EPG display offset, applied in
 * its two forms (`epg-display-offset.util.ts`): the range is shifted for
 * display while progress compares the raw times with the provider clock.
 */
export function buildDashboardLiveEpgDetails(
    program: EpgProgram | null,
    nowMs: number,
    offsetMinutes = 0
): DashboardLiveEpgDetails | null {
    if (!program) {
        return null;
    }

    const description = program.desc?.trim();
    const category = program.category?.trim();
    const details: DashboardLiveEpgDetails = {
        nowPlayingTitle: program.title?.trim() || null,
        nowPlayingTimeRange: formatEpgTimeRange(program, offsetMinutes),
        nowPlayingProgress: calcEpgProgress(
            program,
            epgProviderClockMs(nowMs, offsetMinutes)
        ),
        ...(description ? { nowPlayingDescription: description } : {}),
        ...(category ? { nowPlayingCategory: category } : {}),
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

/** One XMLTV lookup: the scope it is answered in and the keys asked for. */
export interface DashboardLiveEpgLookupGroup {
    /** Identity of the scope, as `liveEpgScopeKey` builds it. */
    readonly scopeKey: string;
    readonly sourceUrls: string[];
    readonly lookupKeys: string[];
    /** Whether unresolved keys may be retried against every imported guide. */
    readonly anySourceFallback: boolean;
}

/**
 * Only a card whose playlist gave it a real XMLTV key may be retried against
 * every imported guide. An Xtream or Stalker card carries no such key, so the
 * lookup falls back to its display title, and searching every playlist's
 * guide by title would let a same-named M3U channel answer for a portal
 * channel. Those cards keep the strict scope; their own programmes come from
 * the portal instead.
 */
export function liveEpgAllowsAnySource(card: DashboardRailCard): boolean {
    return Boolean(card.epgLookupKey?.trim());
}

/**
 * Cards are grouped by the XMLTV sources their playlist declares, not by the
 * playlist itself: two playlists pointing at the same guide ask one question
 * and share the answer, while two playlists with DIFFERENT guides never do.
 * That separation is the point — a bare `tvg-id` like `ard.de` is not unique
 * across imports, so one flat map keyed by lookup key alone would hand one
 * playlist's card the other playlist's programme. The any-source flag is part
 * of that identity too: a guide-less M3U playlist and a portal playlist both
 * resolve against Settings, but only the first may widen the search, so their
 * answers for one title are not interchangeable.
 */
export function liveEpgScopeKey(
    sourceUrls: readonly string[],
    anySourceFallback: boolean
): string {
    // JSON, not a separator character: a URL may contain anything, and
    // a raw control byte would classify this source file as binary.
    return JSON.stringify([
        Array.from(new Set(sourceUrls)).sort(),
        anySourceFallback,
    ]);
}

/** Namespaces an answer by the scope it was resolved in. */
export function liveEpgProgramKey(scopeKey: string, lookupKey: string): string {
    return JSON.stringify([scopeKey, lookupKey]);
}

export function buildLiveEpgLookupGroups(
    cards: readonly DashboardRailCard[],
    sourceUrlsForCard: (card: DashboardRailCard) => string[]
): DashboardLiveEpgLookupGroup[] {
    const groups = new Map<
        string,
        {
            sourceUrls: string[];
            lookupKeys: string[];
            anySourceFallback: boolean;
            seen: Set<string>;
        }
    >();

    for (const card of cards) {
        const lookupKey = liveEpgLookupKeyForCard(card);
        if (!lookupKey) continue;

        const sourceUrls = sourceUrlsForCard(card);
        const anySourceFallback = liveEpgAllowsAnySource(card);
        const scopeKey = liveEpgScopeKey(sourceUrls, anySourceFallback);
        const group = groups.get(scopeKey) ?? {
            sourceUrls: Array.from(new Set(sourceUrls)),
            lookupKeys: [],
            anySourceFallback,
            seen: new Set<string>(),
        };
        if (!group.seen.has(lookupKey)) {
            group.seen.add(lookupKey);
            group.lookupKeys.push(lookupKey);
        }
        groups.set(scopeKey, group);
    }

    return Array.from(groups.entries(), ([scopeKey, group]) => ({
        scopeKey,
        sourceUrls: group.sourceUrls,
        lookupKeys: group.lookupKeys,
        anySourceFallback: group.anySourceFallback,
    }));
}

type DashboardLiveEpgRailSettings = Pick<
    DashboardRailsSettings,
    'liveFavorites' | 'recentlyWatchedLive'
>;

/**
 * The rails' live cards whose rails are enabled. Hero candidates are not
 * passed here: `DashboardLiveEpgPresenter` derives and pins them itself.
 */
export function buildLiveEpgCardsForEnabledRails(
    rails: DashboardLiveEpgRailSettings,
    liveFavoriteCards: readonly DashboardRailCard[],
    recentLiveCards: readonly DashboardRailCard[]
): DashboardRailCard[] {
    return [
        ...(rails.liveFavorites ? liveFavoriteCards : []),
        ...(rails.recentlyWatchedLive ? recentLiveCards : []),
    ];
}

/**
 * `epgMap` is keyed by `liveEpgProgramKey`, so a card only ever reads the
 * answer resolved in its own source scope.
 */
export function getLiveEpgProgramForCard(
    card: DashboardRailCard,
    epgMap: ReadonlyMap<string, EpgProgram | null>,
    scopeKey: string
): EpgProgram | null {
    const key = liveEpgLookupKeyForCard(card);
    const program = epgMap.get(liveEpgProgramKey(scopeKey, key));
    if (program) {
        return program;
    }

    const titleKey = card.title.trim();
    return key !== titleKey
        ? (epgMap.get(liveEpgProgramKey(scopeKey, titleKey)) ?? null)
        : null;
}

/**
 * Whether the XMLTV answers for these groups can have gone stale by
 * `providerClockMs` (the raw EPG clock, see `epgProviderClockMs`). A known
 * programme stays correct until it ends, so a lookup is only repeated once
 * one of them has ended, or while a key is still unanswered or answered
 * with nothing on air: a guide imported meanwhile may know it now.
 */
export function liveEpgAnswersNeedRefresh(
    answers: ReadonlyMap<string, EpgProgram | null> | null,
    groups: readonly DashboardLiveEpgLookupGroup[],
    providerClockMs: number
): boolean {
    if (!answers) return true;
    for (const group of groups) {
        for (const lookupKey of group.lookupKeys) {
            const program = answers.get(
                liveEpgProgramKey(group.scopeKey, lookupKey)
            );
            if (!program) return true;
            const stop = epgTimestampMs(program, 'stop');
            if (stop === null || stop <= providerClockMs) return true;
        }
    }
    return false;
}

/**
 * Same keys answered with the same programmes: everything the dashboard
 * renders from one (title, times, description, category) must match, or a
 * guide correction to any of them would be dropped as "unchanged".
 */
export function sameLiveEpgAnswers(
    a: ReadonlyMap<string, EpgProgram | null>,
    b: ReadonlyMap<string, EpgProgram | null>
): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const [key, program] of a) {
        if (!b.has(key)) return false;
        const other = b.get(key) ?? null;
        if (program === other) continue;
        if (
            !program ||
            !other ||
            program.title !== other.title ||
            program.desc !== other.desc ||
            program.category !== other.category ||
            epgTimestampMs(program, 'start') !==
                epgTimestampMs(other, 'start') ||
            epgTimestampMs(program, 'stop') !== epgTimestampMs(other, 'stop')
        ) {
            return false;
        }
    }
    return true;
}
