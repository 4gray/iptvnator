import type {
    MainTimelineRecord,
    WorkerRequestPerformanceMetrics,
} from './m3u-refresh-cancellation-contract';

type InitialImportDatabaseOperation =
    | 'DB_GET_APP_PLAYLIST'
    | 'DB_UPSERT_APP_PLAYLIST';

export interface M3uImportIpcAttribution {
    readonly databaseWorkerToMainCloneProxyMs: number;
    readonly ipcStructuredCloneProxyMs: number;
    readonly mainToDatabaseWorkerCloneProxyMs: number;
    readonly mainToRendererCloneProxyMs: number;
    readonly rendererToMainCloneProxyMs: number;
}

interface RequestBoundaryAttribution {
    readonly mainToDatabaseWorkerMs: number;
    readonly mainToRendererMs: number;
    readonly rendererToMainMs: number;
    readonly successEpochMs: number;
    readonly workerToMainMs: number;
}

export function deriveM3uImportIpcAttribution(input: {
    readonly get: WorkerRequestPerformanceMetrics;
    readonly getReadStartedEpochMs: number;
    readonly importDispatchEndedEpochMs: number;
    readonly importDispatchStartedEpochMs: number;
    readonly normalizeEndedEpochMs: number;
    readonly playlistId: string;
    readonly publishChannelsStartedEpochMs: number;
    readonly serializeStartedEpochMs: number;
    readonly timeline: readonly MainTimelineRecord[];
    readonly upsert: WorkerRequestPerformanceMetrics;
}): M3uImportIpcAttribution {
    requireOrdered(
        input.normalizeEndedEpochMs,
        input.importDispatchStartedEpochMs
    );
    requireOrdered(
        input.importDispatchStartedEpochMs,
        input.importDispatchEndedEpochMs
    );

    const upsert = deriveRequestBoundaryAttribution({
        operation: 'DB_UPSERT_APP_PLAYLIST',
        playlistId: input.playlistId,
        request: input.upsert,
        timeline: input.timeline,
        workPhaseStartedEpochMs: input.serializeStartedEpochMs,
    });
    requireOrdered(input.importDispatchEndedEpochMs, requireSource(input.upsert));

    const get = deriveRequestBoundaryAttribution({
        operation: 'DB_GET_APP_PLAYLIST',
        playlistId: input.playlistId,
        request: input.get,
        timeline: input.timeline,
        workPhaseStartedEpochMs: input.getReadStartedEpochMs,
    });
    requireOrdered(upsert.successEpochMs, requireSource(input.get));
    requireOrdered(
        get.successEpochMs,
        input.publishChannelsStartedEpochMs
    );

    const initialMainToRendererMs = difference(
        input.importDispatchStartedEpochMs,
        input.normalizeEndedEpochMs
    );
    const mainToRendererCloneProxyMs =
        initialMainToRendererMs +
        upsert.mainToRendererMs +
        get.mainToRendererMs;
    const rendererToMainCloneProxyMs =
        upsert.rendererToMainMs + get.rendererToMainMs;
    const mainToDatabaseWorkerCloneProxyMs =
        upsert.mainToDatabaseWorkerMs + get.mainToDatabaseWorkerMs;
    const databaseWorkerToMainCloneProxyMs =
        upsert.workerToMainMs + get.workerToMainMs;

    return Object.freeze({
        databaseWorkerToMainCloneProxyMs,
        ipcStructuredCloneProxyMs:
            mainToRendererCloneProxyMs +
            rendererToMainCloneProxyMs +
            mainToDatabaseWorkerCloneProxyMs +
            databaseWorkerToMainCloneProxyMs,
        mainToDatabaseWorkerCloneProxyMs,
        mainToRendererCloneProxyMs,
        rendererToMainCloneProxyMs,
    });
}

function deriveRequestBoundaryAttribution(input: {
    readonly operation: InitialImportDatabaseOperation;
    readonly playlistId: string;
    readonly request: WorkerRequestPerformanceMetrics;
    readonly timeline: readonly MainTimelineRecord[];
    readonly workPhaseStartedEpochMs: number;
}): RequestBoundaryAttribution {
    requireInitialImportPreloadIdentity(input.request, input.operation);
    const requestTimeline = requireTimelineRecord(
        input.timeline,
        'db-request',
        input.request,
        input.operation,
        input.playlistId
    );
    requireTimelineRecord(
        input.timeline,
        'db-response',
        input.request,
        input.operation,
        input.playlistId
    );
    const successTimeline = requireTimelineRecord(
        input.timeline,
        'preload-performance-success',
        input.request,
        input.operation,
        input.playlistId
    );
    const sourceEpochMs = requireSource(input.request);
    const requestReceivedEpochMs = requireTimestamp(
        input.request.requestReceivedEpochMs
    );
    const workStartedEpochMs = requireTimestamp(
        input.request.workStartedEpochMs
    );
    const workEndedEpochMs = requireTimestamp(input.request.workEndedEpochMs);
    const responsePostedEpochMs = requireTimestamp(
        input.request.responsePostedEpochMs
    );
    const responseEpochMs = requireTimestamp(input.request.responseEpochMs);
    const successEpochMs = requireTimestamp(successTimeline.sourceEpochMs);

    requireOrdered(sourceEpochMs, requestTimeline.epochMs);
    requireOrdered(requestTimeline.epochMs, requestReceivedEpochMs);
    requireOrdered(requestReceivedEpochMs, workStartedEpochMs);
    requireOrdered(workStartedEpochMs, input.workPhaseStartedEpochMs);
    requireOrdered(input.workPhaseStartedEpochMs, workEndedEpochMs);
    requireOrdered(workEndedEpochMs, responsePostedEpochMs);
    requireOrdered(responsePostedEpochMs, responseEpochMs);
    requireOrdered(responseEpochMs, successEpochMs);

    return {
        mainToDatabaseWorkerMs: difference(
            requestReceivedEpochMs,
            requestTimeline.epochMs
        ),
        mainToRendererMs: difference(successEpochMs, responseEpochMs),
        rendererToMainMs: difference(requestTimeline.epochMs, sourceEpochMs),
        successEpochMs,
        workerToMainMs: difference(responseEpochMs, responsePostedEpochMs),
    };
}

function requireTimelineRecord(
    timeline: readonly MainTimelineRecord[],
    type: 'db-request' | 'db-response' | 'preload-performance-success',
    request: WorkerRequestPerformanceMetrics,
    operation: InitialImportDatabaseOperation,
    playlistId: string
): MainTimelineRecord {
    if (!request.requestId || !Number.isSafeInteger(request.ipcCallId)) {
        throw new Error('database-request-identity-missing');
    }
    const matches = timeline.filter((record) => {
        if (
            record.type !== type ||
            record.operation !== operation ||
            record.playlistId !== playlistId
        ) {
            return false;
        }
        if (type === 'preload-performance-success') {
            return (
                record.ipcCallId === request.ipcCallId &&
                record.sourceEpochMs !== undefined &&
                record.success === true
            );
        }
        return (
            record.requestId === request.requestId &&
            (type !== 'db-response' || record.success === true)
        );
    });
    if (matches.length !== 1 || !matches[0]) {
        throw new Error(`database-${type}-timeline-correlation`);
    }
    const record = matches[0];
    if (
        type === 'db-request' &&
        (record.ipcCallId !== request.ipcCallId ||
            record.sourceEpochMs !== request.sourceEpochMs)
    ) {
        throw new Error('database-request-timeline-identity');
    }
    return record;
}

function requireInitialImportPreloadIdentity(
    request: WorkerRequestPerformanceMetrics,
    operation: InitialImportDatabaseOperation
): void {
    if (
        request.operation !== operation ||
        !request.success ||
        request.performanceCaptureUnavailableReason !== null ||
        !Number.isSafeInteger(request.ipcCallId) ||
        Number(request.ipcCallId) < 1 ||
        typeof request.sourceEpochMs !== 'number' ||
        !Number.isFinite(request.sourceEpochMs) ||
        request.sourceEpochMs < 0 ||
        request.operationId !== null ||
        request.operationIdUnavailableReason !==
            'preload-performance-marker-uncorrelated'
    ) {
        throw new Error('database-request-preload-identity');
    }
}

function requireSource(request: WorkerRequestPerformanceMetrics): number {
    return requireTimestamp(request.sourceEpochMs);
}

function requireTimestamp(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('database-request-timestamp-missing');
    }
    return value;
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
