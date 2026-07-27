import {
    APP_PLAYLIST_GET_PERFORMANCE_PHASE,
    APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE,
    M3U_IMPORT_PERFORMANCE_PHASE,
} from '@iptvnator/shared/interfaces';

import type { M3uImportRendererCaptureMetrics } from './m3u-import-renderer-capture';
import type {
    MainCaptureMetrics,
    MainTimelineRecord,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';
import { deriveM3uImportIpcAttribution } from './m3u-import-ipc-attribution';
import {
    pairPerformancePhaseEvents,
    requirePerformancePhase,
    type PairedPerformancePhase,
} from './performance-phase-events';
import {
    pairRendererPerformancePhaseEvents,
    requireRendererPerformancePhase,
} from './renderer-performance-phase-events';

export const M3U_IMPORT_INDEX_COMMIT_UNAVAILABLE_REASON =
    'indexes-not-created-during-import;sqlite-autocommit-included-in-sqlite-write';

export interface M3uImportPhaseMetrics {
    readonly angularRenderingMs: number;
    readonly dataAcquireMs: number;
    readonly databaseWorkerToMainCloneProxyMs: number;
    readonly indexAndCommitMs: null;
    readonly indexAndCommitUnavailableReason: typeof M3U_IMPORT_INDEX_COMMIT_UNAVAILABLE_REASON;
    readonly ipcStructuredCloneProxyMs: number;
    readonly mainToDatabaseWorkerCloneProxyMs: number;
    readonly mainToRendererCloneProxyMs: number;
    readonly m3uParsingMs: number;
    readonly normalizationMs: number;
    readonly playlistDeserializationMs: number;
    readonly playlistSerializationMs: number;
    readonly rendererToMainCloneProxyMs: number;
    readonly sqliteReadMs: number;
    readonly sqliteWriteMs: number;
    readonly storeImportDispatchMs: number;
    readonly storePublishChannelsMs: number;
    readonly storeUpdateMs: number;
    readonly totalMs: number;
}

export interface M3uImportPhaseDerivationInput {
    readonly channelCount: number;
    readonly fixtureBytes: number;
    readonly main: MainCaptureMetrics;
    readonly renderer: M3uImportRendererCaptureMetrics;
}

export function deriveM3uImportPhaseMetrics(
    input: M3uImportPhaseDerivationInput
): M3uImportPhaseMetrics {
    try {
        return deriveM3uImportPhaseMetricsStrict(input);
    } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`m3u-import-phase-attribution-invalid:${detail}`);
    }
}

function deriveM3uImportPhaseMetricsStrict(
    input: M3uImportPhaseDerivationInput
): M3uImportPhaseMetrics {
    requirePositiveSafeCount(input.channelCount, 'channel-count');
    requirePositiveSafeCount(input.fixtureBytes, 'fixture-bytes');

    const mainPhases = pairPerformancePhaseEvents(
        input.main.timeline
            .filter((event) => event.type === 'm3u-import-phase')
            .map(toPerformancePhaseEvent)
    );
    if (mainPhases.length !== 3) {
        throw new Error('main-phase-cardinality');
    }
    const mainRequestIds = new Set(mainPhases.map((phase) => phase.requestId));
    if (mainRequestIds.size !== 1) {
        throw new Error('main-request-correlation');
    }
    const mainRequestId = mainPhases[0]?.requestId;
    if (!mainRequestId) {
        throw new Error('main-request-missing');
    }
    const dataAcquire = requirePerformancePhase(
        mainPhases,
        mainRequestId,
        M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE
    );
    const parseM3u = requirePerformancePhase(
        mainPhases,
        mainRequestId,
        M3U_IMPORT_PERFORMANCE_PHASE.PARSE_M3U
    );
    const normalize = requirePerformancePhase(
        mainPhases,
        mainRequestId,
        M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE
    );
    requireMetadataCount(
        dataAcquire,
        'byteCount',
        input.fixtureBytes,
        'data-acquire-bytes'
    );
    requireMetadataCount(
        parseM3u,
        'itemCount',
        input.channelCount,
        'parse-items'
    );
    requireMetadataCount(
        normalize,
        'itemCount',
        input.channelCount,
        'normalize-items'
    );
    requireOrdered(dataAcquire.endedEpochMs, parseM3u.startedEpochMs);
    requireOrdered(parseM3u.endedEpochMs, normalize.startedEpochMs);

    const rendererEvents = (
        input.renderer.probe as typeof input.renderer.probe & {
            readonly performancePhaseEvents?: readonly unknown[];
        }
    ).performancePhaseEvents;
    if (!rendererEvents) {
        throw new Error('renderer-phase-events-missing');
    }
    const rendererPhases = pairRendererPerformancePhaseEvents(rendererEvents);
    if (rendererPhases.length !== 2) {
        throw new Error('renderer-phase-cardinality');
    }
    const importDispatch = requireRendererPerformancePhase(
        rendererPhases,
        'store.m3u-import-dispatch'
    );
    const publishChannels = requireRendererPerformancePhase(
        rendererPhases,
        'store.m3u-publish-channels'
    );
    requireRendererItems(
        publishChannels.metadata?.items,
        input.channelCount,
        'publish-channels-items'
    );

    const playlistId = input.renderer.probe.playlistId;
    if (typeof playlistId !== 'string' || playlistId.length === 0) {
        throw new Error('renderer-playlist-id-missing');
    }
    const databaseWorkers = input.main.workers.filter(
        (worker) => worker.kind === 'database.worker'
    );
    if (
        databaseWorkers.length !== 1 ||
        input.main.workers.some(
            (worker) => worker.kind === 'playlist-refresh.worker'
        )
    ) {
        throw new Error('worker-cardinality');
    }
    const databaseWorker = databaseWorkers[0];
    if (!databaseWorker) {
        throw new Error('database-worker-missing');
    }
    const upserts = databaseWorker.requests.filter(
        (request) =>
            request.operation === 'DB_UPSERT_APP_PLAYLIST' &&
            request.playlistId === playlistId &&
            request.success
    );
    if (upserts.length !== 1 || !upserts[0]) {
        throw new Error('database-upsert-correlation');
    }
    const upsert = upserts[0];
    const gets = databaseWorker.requests.filter(
        (request) =>
            request.operation === 'DB_GET_APP_PLAYLIST' &&
            request.playlistId === playlistId &&
            request.success
    );
    if (
        gets.length !== 1 ||
        !gets[0] ||
        databaseWorker.requests.length !== 2
    ) {
        throw new Error('database-get-correlation');
    }
    const get = gets[0];
    const databasePhases = pairPerformancePhaseEvents(upsert.phaseEvents);
    if (
        databasePhases.length !== 2 ||
        !upsert.requestId ||
        databasePhases.some((phase) => phase.requestId !== upsert.requestId)
    ) {
        throw new Error('database-phase-cardinality');
    }
    const serializePlaylist = requireDatabasePhase(
        databasePhases,
        upsert,
        APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SERIALIZE_PLAYLIST
    );
    const sqliteWrite = requireDatabasePhase(
        databasePhases,
        upsert,
        APP_PLAYLIST_UPSERT_PERFORMANCE_PHASE.SQLITE_WRITE
    );
    requireMetadataCount(
        serializePlaylist,
        'itemCount',
        input.channelCount,
        'serialization-items'
    );
    requireMetadataCount(sqliteWrite, 'itemCount', 1, 'sqlite-row-count');
    const getPhases = pairPerformancePhaseEvents(get.phaseEvents);
    if (
        getPhases.length !== 2 ||
        !get.requestId ||
        getPhases.some((phase) => phase.requestId !== get.requestId)
    ) {
        throw new Error('database-get-phase-cardinality');
    }
    const sqliteRead = requireDatabasePhase(
        getPhases,
        get,
        APP_PLAYLIST_GET_PERFORMANCE_PHASE.SQLITE_READ
    );
    const deserializePlaylist = requireDatabasePhase(
        getPhases,
        get,
        APP_PLAYLIST_GET_PERFORMANCE_PHASE.DESERIALIZE_PLAYLIST
    );
    requireMetadataCount(sqliteRead, 'itemCount', 1, 'sqlite-read-row-count');
    requireMetadataCount(
        deserializePlaylist,
        'itemCount',
        input.channelCount,
        'deserialization-items'
    );

    const operationStart = input.renderer.phaseTimestamps.operationStartEpochMs;
    const uiPainted = input.renderer.phaseTimestamps.uiPaintedEpochMs;
    const terminal = input.renderer.phaseTimestamps.terminalEpochMs;
    requireOrdered(operationStart, dataAcquire.startedEpochMs);
    requireOrdered(serializePlaylist.endedEpochMs, sqliteWrite.startedEpochMs);
    requireOrdered(sqliteWrite.endedEpochMs, sqliteRead.startedEpochMs);
    requireOrdered(sqliteRead.endedEpochMs, deserializePlaylist.startedEpochMs);
    requireOrdered(
        deserializePlaylist.endedEpochMs,
        publishChannels.startedEpochMs
    );
    requireOrdered(publishChannels.endedEpochMs, uiPainted);
    requireOrdered(uiPainted, terminal);

    const ipc = deriveM3uImportIpcAttribution({
        get,
        getReadStartedEpochMs: sqliteRead.startedEpochMs,
        importDispatchEndedEpochMs: importDispatch.endedEpochMs,
        importDispatchStartedEpochMs: importDispatch.startedEpochMs,
        normalizeEndedEpochMs: normalize.endedEpochMs,
        playlistId,
        publishChannelsStartedEpochMs: publishChannels.startedEpochMs,
        serializeStartedEpochMs: serializePlaylist.startedEpochMs,
        timeline: input.main.timeline,
        upsert,
    });
    const angularRenderingMs = difference(
        uiPainted,
        publishChannels.endedEpochMs
    );
    const totalMs = difference(terminal, operationStart);

    return Object.freeze({
        angularRenderingMs,
        dataAcquireMs: dataAcquire.durationMs,
        indexAndCommitMs: null,
        indexAndCommitUnavailableReason:
            M3U_IMPORT_INDEX_COMMIT_UNAVAILABLE_REASON,
        ...ipc,
        m3uParsingMs: parseM3u.durationMs,
        normalizationMs: normalize.durationMs,
        playlistDeserializationMs: deserializePlaylist.durationMs,
        playlistSerializationMs: serializePlaylist.durationMs,
        sqliteReadMs: sqliteRead.durationMs,
        sqliteWriteMs: sqliteWrite.durationMs,
        storeImportDispatchMs: importDispatch.durationMs,
        storePublishChannelsMs: publishChannels.durationMs,
        storeUpdateMs: importDispatch.durationMs + publishChannels.durationMs,
        totalMs,
    });
}

function toPerformancePhaseEvent(event: MainTimelineRecord): unknown {
    const metadata = {
        ...(event.byteCount === undefined
            ? {}
            : { byteCount: event.byteCount }),
        ...(event.itemCount === undefined
            ? {}
            : { itemCount: event.itemCount }),
    };
    return {
        boundary: event.boundary,
        durationMs: event.durationMs,
        epochMs: event.epochMs,
        ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
        phase: event.phase,
        requestId: event.requestId,
    };
}

function requireDatabasePhase(
    phases: readonly PairedPerformancePhase[],
    request: WorkerRequestPerformanceMetrics,
    phase: string
): PairedPerformancePhase {
    if (!request.requestId) {
        throw new Error('database-request-id-missing');
    }
    return requirePerformancePhase(phases, request.requestId, phase);
}

function requireMetadataCount(
    phase: PairedPerformancePhase,
    key: 'byteCount' | 'itemCount',
    expected: number,
    label: string
): void {
    if (phase.metadata?.[key] !== expected) {
        throw new Error(label);
    }
}

function requireRendererItems(
    value: number | undefined,
    expected: number,
    label: string
): void {
    if (value !== expected) {
        throw new Error(label);
    }
}

function requirePositiveSafeCount(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(label);
    }
}

function requireOrdered(startEpochMs: number, endEpochMs: number): void {
    if (
        !Number.isFinite(startEpochMs) ||
        !Number.isFinite(endEpochMs) ||
        endEpochMs < startEpochMs
    ) {
        throw new Error('phase-order');
    }
}

function difference(endEpochMs: number, startEpochMs: number): number {
    requireOrdered(startEpochMs, endEpochMs);
    return endEpochMs - startEpochMs;
}
