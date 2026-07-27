import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
} from './xtream-benchmark-contract';
import { iteration } from './xtream-benchmark-report.fixtures';
import {
    xtreamIpcProducerIdentityKey,
    xtreamIpcProducerNamespaceForMethod,
    xtreamIpcProducerNamespaceForWorkerOperation,
} from './xtream-ipc-producer-identity';
import { attributeXtreamPhases } from './xtream-phase-attribution';
import { scenarioCapture } from './xtream-phase-attribution.fixtures';
import { assertXtreamIterationResult } from './xtream-iteration-validity';

const DB_METHOD_OPERATION = new Map([
    ['dbDeletePlaylist', 'DB_DELETE_PLAYLIST'],
    ['dbDeleteXtreamContent', 'DB_DELETE_XTREAM_CONTENT'],
    ['dbGetAppPlaylist', 'DB_GET_APP_PLAYLIST'],
    ['dbGetCategories', 'DB_GET_CATEGORIES'],
    ['dbGetContent', 'DB_GET_CONTENT'],
    ['dbRestoreXtreamUserData', 'DB_RESTORE_XTREAM_USER_DATA'],
    ['dbSaveCategories', 'DB_SAVE_CATEGORIES'],
    ['dbSaveContent', 'DB_SAVE_CONTENT'],
    ['dbUpsertAppPlaylist', 'DB_UPSERT_APP_PLAYLIST'],
]);

describe('Xtream IPC attribution producer identity', () => {
    it('requires exact pairs, distinct call IDs, and source chronology', () => {
        const initial = scenarioCapture(
            XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
        );
        const requests = initial.ipcSpans
            .filter(
                ({ boundary, method }) =>
                    boundary === 'request' && method === 'dbGetCategories'
            )
            .sort((left, right) => left.ipcCallId - right.ipcCallId);
        const first = requests[0];
        const second = requests[1];
        assert.ok(first);
        assert.ok(second);
        const pairDrift = initial.ipcSpans.map((span) =>
            span.correlationId === first.correlationId &&
            span.boundary === 'response'
                ? { ...span, ipcCallId: span.ipcCallId + 1 }
                : span
        );
        const sourcePairDrift = initial.ipcSpans.map((span) =>
            span.correlationId === first.correlationId &&
            span.boundary === 'response'
                ? { ...span, sourceEpochMs: span.sourceEpochMs + 0.01 }
                : span
        );
        const duplicate = initial.ipcSpans.map((span) =>
            span.correlationId === second.correlationId
                ? { ...span, ipcCallId: first.ipcCallId }
                : span
        );
        const chronologyRegression = initial.ipcSpans.map((span) =>
            span.correlationId === first.correlationId
                ? { ...span, sourceEpochMs: 100.75 }
                : span
        );

        for (const ipcSpans of [
            pairDrift,
            sourcePairDrift,
            duplicate,
            chronologyRegression,
        ]) {
            assert.throws(
                () => attributeXtreamPhases({ ...initial, ipcSpans }),
                /invalid Xtream phase capture/
            );
        }
    });

    it('accepts one numeric call ID in each independent preload producer namespace', () => {
        const raw = iteration(
            {
                eligibleForComparison: true,
                kind: XTREAM_ITERATION_KIND.MEASURED,
                runId: 'run-01',
                scenarioId: XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE,
            },
            1
        );
        const legacy = raw.phaseCapture.ipcSpans.find(
            ({ boundary, method }) =>
                boundary === 'request' && method === 'dbGetAppPlaylist'
        );
        const xtream = raw.phaseCapture.ipcSpans.find(
            ({ boundary, method }) =>
                boundary === 'request' && method === 'dbGetCategories'
        );
        assert.ok(legacy);
        assert.ok(xtream);
        assert.equal(legacy.ipcCallId, xtream.ipcCallId);
        const legacySourceEpochMs = legacy.sourceEpochMs + 0.25;
        const ipcSpans = raw.phaseCapture.ipcSpans.map((span) => {
            if (
                xtreamIpcProducerNamespaceForMethod(span.method) ===
                'legacy-preload'
            ) {
                return { ...span, sourceEpochMs: legacySourceEpochMs };
            }
            return span.correlationId === xtream.correlationId
                ? { ...span, ipcCallId: legacy.ipcCallId }
                : span;
        });
        const requests = raw.databaseWorker.requests.evidence.map((request) => {
            if (
                xtreamIpcProducerNamespaceForWorkerOperation(
                    request.operation ?? ''
                ) === 'legacy-preload'
            ) {
                return { ...request, sourceEpochMs: legacySourceEpochMs };
            }
            return request.ipcCallId === xtream.ipcCallId &&
                request.operation === 'DB_GET_CATEGORIES'
                ? { ...request, ipcCallId: legacy.ipcCallId }
                : request;
        });

        assert.doesNotThrow(() =>
            assertXtreamIterationResult({
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    requests: {
                        ...raw.databaseWorker.requests,
                        evidence: requests,
                    },
                },
                phaseCapture: { ...raw.phaseCapture, ipcSpans },
            })
        );
    });

    it('does not collide a cancellation call with the legacy preload namespace', () => {
        const raw = iteration(
            {
                eligibleForComparison: true,
                kind: XTREAM_ITERATION_KIND.MEASURED,
                runId: 'run-01',
                scenarioId: XTREAM_SCENARIO_ID.CANCEL_IMPORT,
            },
            1
        );
        const cancellation = raw.phaseCapture.ipcSpans.find(
            ({ boundary, method }) =>
                boundary === 'request' && method === 'dbCancelOperation'
        );
        const legacy = raw.phaseCapture.ipcSpans.find(
            ({ boundary, method }) =>
                boundary === 'request' && method === 'dbGetAppPlaylist'
        );
        assert.ok(cancellation);
        assert.ok(legacy);
        const ipcSpans = raw.phaseCapture.ipcSpans.map((span) =>
            span.correlationId === legacy.correlationId
                ? { ...span, ipcCallId: cancellation.ipcCallId }
                : span
        );
        const requests = raw.databaseWorker.requests.evidence.map((request) =>
            request.operation === 'DB_GET_APP_PLAYLIST' &&
            request.ipcCallId === legacy.ipcCallId
                ? { ...request, ipcCallId: cancellation.ipcCallId }
                : request
        );

        assert.doesNotThrow(() =>
            assertXtreamIterationResult({
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    requests: {
                        ...raw.databaseWorker.requests,
                        evidence: requests,
                    },
                },
                phaseCapture: { ...raw.phaseCapture, ipcSpans },
            })
        );
    });

    it('shares each database preload identity with its worker request', () => {
        for (const scenarioId of Object.values(XTREAM_SCENARIO_ID)) {
            const raw = iteration(
                {
                    eligibleForComparison: true,
                    kind: XTREAM_ITERATION_KIND.MEASURED,
                    runId: 'run-01',
                    scenarioId,
                },
                1
            );
            const workersByProducerIdentity = new Map(
                raw.databaseWorker.requests.evidence.flatMap((request) =>
                    request.ipcCallId === null
                        ? []
                        : [
                              [
                                  workerIdentityKey(
                                      request.operation ?? '',
                                      request.ipcCallId
                                  ),
                                  request,
                              ] as const,
                          ]
                )
            );
            for (const span of raw.phaseCapture.ipcSpans) {
                if (span.boundary !== 'request') continue;
                const operation = DB_METHOD_OPERATION.get(span.method);
                if (!operation) continue;
                const namespace = xtreamIpcProducerNamespaceForMethod(
                    span.method
                );
                assert.ok(namespace);
                const worker = workersByProducerIdentity.get(
                    xtreamIpcProducerIdentityKey(namespace, span.ipcCallId)
                );
                assert.ok(worker);
                assert.equal(worker.operation, operation);
                assert.equal(worker.sourceEpochMs, span.sourceEpochMs);
            }
        }
    });
});

function workerIdentityKey(operation: string, ipcCallId: number): string {
    const namespace = xtreamIpcProducerNamespaceForWorkerOperation(operation);
    assert.ok(namespace);
    return xtreamIpcProducerIdentityKey(namespace, ipcCallId);
}
