import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import type {
    XtreamIpcAttributionSpan,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import { xtreamWorkerOperationForIpcMethod } from './xtream-ipc-worker-identity-binding';

interface ProducerIdentity {
    readonly ipcCallId: number;
    readonly sourceEpochMs: number;
}

export function bindFixtureIpcWorkerIdentities(
    input: XtreamPhaseAttributionInput,
    requests: readonly WorkerRequestPerformanceMetrics[]
): {
    readonly phaseCapture: XtreamPhaseAttributionInput;
    readonly requests: readonly WorkerRequestPerformanceMetrics[];
} {
    const identities = new Map<
        WorkerRequestPerformanceMetrics,
        ProducerIdentity
    >();
    const methods = new Set(
        input.ipcSpans
            .filter(({ boundary }) => boundary === 'request')
            .map(({ method }) => method)
            .filter(
                (method) => xtreamWorkerOperationForIpcMethod(method) !== null
            )
    );
    for (const method of methods) {
        const operation = xtreamWorkerOperationForIpcMethod(method);
        if (operation === null) fixtureError();
        const calls = requestSpans(input.ipcSpans, method);
        const workers = requests
            .filter((request) => request.operation === operation)
            .sort(
                (left, right) =>
                    Number(left.requestReceivedEpochMs) -
                        Number(right.requestReceivedEpochMs) ||
                    String(left.requestId).localeCompare(
                        String(right.requestId)
                    )
            );
        if (calls.length !== workers.length) fixtureError();
        calls.forEach((call, index) => {
            const worker = workers[index];
            if (
                !worker ||
                call.outcome !== (worker.success ? 'success' : 'error') ||
                worker.requestReceivedEpochMs === null ||
                call.sourceEpochMs > worker.requestReceivedEpochMs
            ) {
                fixtureError();
            }
            identities.set(worker, {
                ipcCallId: call.ipcCallId,
                sourceEpochMs: call.sourceEpochMs,
            });
        });
    }
    const bound = requests.map((request) => {
        const identity = identities.get(request);
        if (identity) return { ...request, ...identity };
        if (request.ipcCallId !== null || request.sourceEpochMs !== null) {
            fixtureError();
        }
        return request;
    });
    return { phaseCapture: input, requests: bound };
}

function requestSpans(
    spans: readonly XtreamIpcAttributionSpan[],
    method: string
): readonly XtreamIpcAttributionSpan[] {
    return spans
        .filter((span) => span.boundary === 'request' && span.method === method)
        .sort((left, right) => left.ipcCallId - right.ipcCallId);
}

function fixtureError(): never {
    throw new Error('invalid Xtream IPC worker identity fixture');
}
