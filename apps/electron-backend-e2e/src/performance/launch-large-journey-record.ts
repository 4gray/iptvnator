import type { JourneyIpcLogEvent } from './journey-main-ipc-capture';
import type { JourneyRendererProbePhaseOptions } from './journey-renderer-probe';
import type { JourneySentinelSqlState } from './journey-sentinel-sql';
import type { JourneyIterationRecord } from './journey-summary';
import {
    LAUNCH_JOURNEY_COUNTER,
    toLaunchIterationRecord,
    type LaunchJourneyMeasurement,
} from './launch-journey-record';

/**
 * J1 on the large-library profile (`launch-large`): J1's record without
 * the idle window, plus the "dashboard rails settled" phase and the
 * startup reads that #1877 and #1883 found slow on a real large database.
 * Contract: docs/architecture/performance-journeys.md.
 */
export const LAUNCH_LARGE_JOURNEY_ID = 'launch-large';
export const LAUNCH_LARGE_RAILS_PHASE = 'dashboardRailsSettled';
export const LAUNCH_LARGE_RAILS_SENTINEL_ID =
    '__iptvnator-journey-launch-large-rails-settled__';
/** Names of the two SQL samples the main process stamps. */
export const LAUNCH_LARGE_SQL_SAMPLE = {
    FIRST_CARD: 'firstCard',
    RAILS_SETTLED: 'railsSettled',
} as const;
/** A pre-fix profile took 97 s cold; the phase must outlast that. */
export const LAUNCH_LARGE_RAILS_TIMEOUT_MS = 240_000;

/**
 * Every rail the profile feeds, with a card, and the hero with a slide: the
 * profile has history with positions, live and VOD favorites, live history,
 * sources and recently added Xtream titles, so each of these is certain to
 * render. The TMDB rails need the opt-in and stay off.
 */
export const LAUNCH_LARGE_RAILS_REQUIRED_SELECTORS: readonly string[] = [
    '[data-test-id="dashboard-hero-slide"]',
    '[data-test-id="dashboard-continue-watching-rail-card"]',
    '[data-test-id="dashboard-live-favorites-rail-card"]',
    '[data-test-id="dashboard-recent-live-rail-card"]',
    '[data-test-id="dashboard-favorite-vod-rail-card"]',
    '[data-test-id="dashboard-recent-sources-rail-card"]',
    '[data-test-id="dashboard-xtream-recently-added-rail-card"]',
];
export const LAUNCH_LARGE_RAILS_ABSENT_SELECTORS: readonly string[] = [
    '[data-test-id$="-rail-skeleton"]',
    '[data-test-id="dashboard-hero-skeleton"]',
];

export function createLaunchLargeJourneyPhases(): JourneyRendererProbePhaseOptions[] {
    return [
        {
            absentSelectors: [...LAUNCH_LARGE_RAILS_ABSENT_SELECTORS],
            name: LAUNCH_LARGE_RAILS_PHASE,
            requiredSelectors: [...LAUNCH_LARGE_RAILS_REQUIRED_SELECTORS],
            sentinelId: LAUNCH_LARGE_RAILS_SENTINEL_ID,
            timeoutMs: LAUNCH_LARGE_RAILS_TIMEOUT_MS,
        },
    ];
}

export const LAUNCH_LARGE_JOURNEY_COUNTER = {
    DOM_MUTATIONS_TO_RAILS_SETTLED: 'renderer.domMutationsToRailsSettled',
    PLAYBACK_POSITION_CALLS: 'renderer.playbackPositionCallsToRailsSettled',
    SQL_STATEMENTS_TO_FIRST_CARD: 'main.sqlStatementsToFirstCard',
    SQL_STATEMENTS_TO_RAILS_SETTLED: 'main.sqlStatementsToRailsSettled',
} as const;

export const LAUNCH_LARGE_JOURNEY_WALL_CLOCK = {
    FIRST_CARD_TO_RAILS_SETTLED: 'firstCardToRailsSettledMs',
    LOAD_TO_FIRST_DB_RESPONSE: 'loadToFirstDbResponseMs',
    PLAYBACK_POSITIONS_SPAN: 'playbackPositionsSpanMs',
    PLAYLIST_METAS: 'playlistMetasMs',
    SPAWN_TO_RAILS_SETTLED: 'spawnToRailsSettledMs',
} as const;

export const LAUNCH_LARGE_JOURNEY_UNAVAILABLE_COUNTERS: Readonly<
    Record<string, string>
> = Object.freeze({
    'main.rowsScannedToFirstCard':
        'the SQL hook counts statement executions; rows scanned would need sqlite3_stmt_status per statement, which the shared connection does not read',
    [LAUNCH_JOURNEY_COUNTER.CD_TICKS_IDLE]:
        'no idle window: the large profile measures startup, and the 30 s window is J1 evidence for the zoneless baseline',
});

/** Bridge methods whose durations the record derives from the IPC log. */
export const LAUNCH_LARGE_TIMED_METHODS = {
    PLAYBACK_POSITIONS: 'dbGetAllPlaybackPositions',
    PLAYLIST_METAS: 'dbGetAppPlaylistMetas',
} as const;

export interface LaunchLargeJourneyMeasurement extends LaunchJourneyMeasurement {
    readonly sqlAtSentinels: JourneySentinelSqlState;
}

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

interface MethodSpan {
    readonly calls: number;
    /** First start to last completion among the calls, milliseconds. */
    readonly spanMs: number;
    readonly firstStartEpochMs: number | null;
    readonly lastEndEpochMs: number | null;
}

/** Calls of `method` whose start arrived at or before `untilEpochMs`. */
function methodSpan(
    log: readonly JourneyIpcLogEvent[],
    method: string,
    untilEpochMs: number
): MethodSpan {
    let calls = 0;
    let firstStart: number | null = null;
    let lastEnd: number | null = null;
    let pending = 0;
    for (const event of log) {
        if (event.method !== method) continue;
        if (event.phase === 'start') {
            if (event.epochMs > untilEpochMs) break;
            calls += 1;
            pending += 1;
            firstStart ??= event.epochMs;
        } else if (pending > 0) {
            pending -= 1;
            lastEnd = event.epochMs;
        }
    }
    return {
        calls,
        firstStartEpochMs: firstStart,
        lastEndEpochMs: lastEnd,
        spanMs:
            firstStart === null || lastEnd === null ? 0 : lastEnd - firstStart,
    };
}

/** Per database method: calls and when they ran, relative to the load. */
export function summarizeDatabaseCalls(
    log: readonly JourneyIpcLogEvent[],
    loadEventEndEpochMs: number
): Record<
    string,
    {
        calls: number;
        firstStartAfterLoadMs: number;
        lastEndAfterLoadMs: number | null;
    }
> {
    const summary: Record<
        string,
        {
            calls: number;
            firstStartAfterLoadMs: number;
            lastEndAfterLoadMs: number | null;
        }
    > = {};
    for (const event of log) {
        if (!event.method.startsWith('db')) continue;
        const entry = summary[event.method];
        if (event.phase === 'start') {
            if (entry === undefined) {
                summary[event.method] = {
                    calls: 1,
                    firstStartAfterLoadMs: roundTenth(
                        event.epochMs - loadEventEndEpochMs
                    ),
                    lastEndAfterLoadMs: null,
                };
            } else {
                entry.calls += 1;
            }
        } else if (entry !== undefined) {
            entry.lastEndAfterLoadMs = roundTenth(
                event.epochMs - loadEventEndEpochMs
            );
        }
    }
    return summary;
}

export function toLaunchLargeIterationRecord(
    index: number,
    warmup: boolean,
    measurement: LaunchLargeJourneyMeasurement
): JourneyIterationRecord {
    const base = toLaunchIterationRecord(index, warmup, measurement, {
        idleWindow: false,
    });
    const { ipc, renderer, spawnEpochMs, sqlAtSentinels } = measurement;
    const phase = renderer.phases[LAUNCH_LARGE_RAILS_PHASE];
    if (
        phase === undefined ||
        phase.status !== 'reached' ||
        phase.epochMs === null ||
        phase.afterFirstCardMs === null
    ) {
        throw new Error(
            `launch-large-record-rails-${phase?.status ?? 'missing'}: ${phase?.missing.join(', ') ?? ''}`
        );
    }
    if (phase.sentinelStatus !== 'sent') {
        throw new Error(
            `launch-large-record-rails-sentinel-${phase.sentinelStatus}`
        );
    }
    const firstCardSql = sqlAtSentinels[LAUNCH_LARGE_SQL_SAMPLE.FIRST_CARD];
    const railsSql = sqlAtSentinels[LAUNCH_LARGE_SQL_SAMPLE.RAILS_SETTLED];
    if (!firstCardSql || !railsSql) {
        throw new Error('launch-large-record-sql-samples-missing');
    }
    if (railsSql.sqlStatements < firstCardSql.sqlStatements) {
        throw new Error('launch-large-record-sql-samples-order');
    }
    if (ipc.logDropped > 0) {
        throw new Error(
            `launch-large-record-ipc-log-dropped-${ipc.logDropped}`
        );
    }
    const loadEventEndEpochMs =
        renderer.navigation?.loadEventEndEpochMs ?? Number.NaN;
    const firstDbResponse = ipc.log.find(
        (event) => event.phase === 'end' && event.method.startsWith('db')
    );
    if (firstDbResponse === undefined) {
        throw new Error('launch-large-record-no-database-response');
    }
    const metas = methodSpan(
        ipc.log,
        LAUNCH_LARGE_TIMED_METHODS.PLAYLIST_METAS,
        phase.epochMs
    );
    if (metas.calls === 0 || metas.lastEndEpochMs === null) {
        throw new Error('launch-large-record-no-playlist-metas-read');
    }
    const positions = methodSpan(
        ipc.log,
        LAUNCH_LARGE_TIMED_METHODS.PLAYBACK_POSITIONS,
        phase.epochMs
    );
    if (positions.calls === 0 || positions.lastEndEpochMs === null) {
        throw new Error('launch-large-record-no-playback-position-reads');
    }
    return Object.freeze({
        ...base,
        counters: Object.freeze({
            ...base.counters,
            [LAUNCH_LARGE_JOURNEY_COUNTER.DOM_MUTATIONS_TO_RAILS_SETTLED]:
                renderer.counters.domMutations + phase.domMutations,
            [LAUNCH_LARGE_JOURNEY_COUNTER.PLAYBACK_POSITION_CALLS]:
                positions.calls,
            [LAUNCH_LARGE_JOURNEY_COUNTER.SQL_STATEMENTS_TO_FIRST_CARD]:
                firstCardSql.sqlStatements,
            [LAUNCH_LARGE_JOURNEY_COUNTER.SQL_STATEMENTS_TO_RAILS_SETTLED]:
                railsSql.sqlStatements,
        }),
        evidence: Object.freeze({
            ...base.evidence,
            databaseCalls: summarizeDatabaseCalls(ipc.log, loadEventEndEpochMs),
            rails: Object.freeze({
                afterFirstCardMs: roundTenth(phase.afterFirstCardMs),
                domMutations: phase.domMutations,
                epochMs: phase.epochMs,
                sqlSampledAtEpochMs: railsSql.epochMs,
            }),
            sqlAtSentinels,
            startup: Object.freeze({
                firstDatabaseResponse: Object.freeze({
                    afterLoadMs: roundTenth(
                        firstDbResponse.epochMs - loadEventEndEpochMs
                    ),
                    method: firstDbResponse.method,
                }),
                playbackPositions: Object.freeze({
                    calls: positions.calls,
                    firstStartAfterLoadMs: roundTenth(
                        (positions.firstStartEpochMs ?? Number.NaN) -
                            loadEventEndEpochMs
                    ),
                    spanMs: roundTenth(positions.spanMs),
                }),
                playlistMetas: Object.freeze({
                    calls: metas.calls,
                    firstStartAfterLoadMs: roundTenth(
                        (metas.firstStartEpochMs ?? Number.NaN) -
                            loadEventEndEpochMs
                    ),
                    spanMs: roundTenth(metas.spanMs),
                }),
            }),
        }),
        wallClock: Object.freeze({
            ...base.wallClock,
            [LAUNCH_LARGE_JOURNEY_WALL_CLOCK.FIRST_CARD_TO_RAILS_SETTLED]:
                roundTenth(phase.afterFirstCardMs),
            [LAUNCH_LARGE_JOURNEY_WALL_CLOCK.LOAD_TO_FIRST_DB_RESPONSE]:
                roundTenth(firstDbResponse.epochMs - loadEventEndEpochMs),
            [LAUNCH_LARGE_JOURNEY_WALL_CLOCK.PLAYBACK_POSITIONS_SPAN]:
                roundTenth(positions.spanMs),
            [LAUNCH_LARGE_JOURNEY_WALL_CLOCK.PLAYLIST_METAS]: roundTenth(
                metas.spanMs
            ),
            [LAUNCH_LARGE_JOURNEY_WALL_CLOCK.SPAWN_TO_RAILS_SETTLED]:
                roundTenth(phase.epochMs - spawnEpochMs),
        }),
    });
}
