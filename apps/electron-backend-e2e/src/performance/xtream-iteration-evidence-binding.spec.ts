import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamIterationDefinition,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { iteration } from './xtream-benchmark-report.fixtures';
import { assertXtreamIterationResult } from './xtream-iteration-validity';
import type { XtreamRawIterationResult } from './xtream-summary-contract';

describe('Xtream persisted iteration evidence binding', () => {
    it('rejects an independently edited phase headline', () => {
        const raw = createIteration();

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    phases: {
                        ...raw.phases,
                        sqliteWriteMs: 99,
                    },
                }),
            /invalid Xtream iteration/
        );
    });

    it('rejects worker phase evidence that no longer backs the phase headline', () => {
        const raw = createIteration();
        const requests = raw.databaseWorker.requests.evidence.map((request) => {
            if (request.operation !== 'DB_SAVE_CONTENT') return request;
            const phaseEvents = request.phaseEvents.map((event, index) =>
                index === 1
                    ? {
                          ...event,
                          durationMs: 1.5,
                          epochMs: event.epochMs + 0.5,
                      }
                    : event
            );
            return { ...request, phaseEvents };
        });

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    databaseWorker: {
                        ...raw.databaseWorker,
                        requests: {
                            ...raw.databaseWorker.requests,
                            evidence: requests,
                        },
                    },
                }),
            /invalid Xtream iteration/
        );
    });

    it('rejects a self-consistent cancel headline outside the failed request', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const cancellation = {
            ...raw.cancellation,
            authoritativeTerminalEpochMs:
                Number(raw.cancellation.authoritativeTerminalEpochMs) + 5_000,
            clickEpochMs: Number(raw.cancellation.clickEpochMs) + 5_000,
            databaseDispatchEpochMs:
                Number(raw.cancellation.databaseDispatchEpochMs) + 5_000,
            paintedEpochMs: Number(raw.cancellation.paintedEpochMs) + 5_000,
            preloadReturnEpochMs:
                Number(raw.cancellation.preloadReturnEpochMs) + 5_000,
            preloadStartEpochMs:
                Number(raw.cancellation.preloadStartEpochMs) + 5_000,
            workerReceiptEpochMs:
                Number(raw.cancellation.workerReceiptEpochMs) + 5_000,
        };

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    cancellation,
                }),
            /invalid Xtream iteration/
        );
    });

    it('binds the dedicated cancel receipt and failed-request identities exactly', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const receiptDrift = {
            ...raw.cancellation,
            workerReceiptEpochMs:
                Number(raw.cancellation.workerReceiptEpochMs) + 0.5,
            workerReceiptLatencyMs:
                Number(raw.cancellation.workerReceiptLatencyMs) + 0.5,
        };
        const wrongRequest = {
            ...raw.cancellation,
            failedDatabaseRequestId: 'another-request',
        };
        const wrongOperation = {
            ...raw.cancellation,
            failedOperationId: 'another-operation',
        };

        for (const cancellation of [
            receiptDrift,
            wrongRequest,
            wrongOperation,
        ]) {
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...raw,
                        cancellation,
                    }),
                /invalid Xtream iteration/
            );
        }
    });

    it('accepts either ordering of worker receipt and preload return after dispatch', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const dispatch = Number(raw.cancellation.databaseDispatchEpochMs);
        const preloadReturn = Number(raw.cancellation.preloadReturnEpochMs);
        const workerTerminal = Number(
            raw.cancellationEvidence?.timeline.find(
                ({ type }) => type === 'db-cancel-terminal-received'
            )?.epochMs
        );
        const beforeReturn = dispatch + (preloadReturn - dispatch) / 2;
        const afterReturn =
            preloadReturn + (workerTerminal - preloadReturn) / 2;

        assert.notEqual(
            raw.cancellation.workerReceiptEpochMs,
            preloadReturn,
            'fixture receipt must be independent from the preload response'
        );
        for (const receiptEpochMs of [beforeReturn, afterReturn]) {
            assert.doesNotThrow(() =>
                assertXtreamIterationResult(withReceipt(raw, receiptEpochMs))
            );
        }
    });

    it('rejects cancel-receipt identity drift and receipt after the authoritative terminal', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const evidence = cancellationEvidence(raw);
        const receiptIndex = evidence.timeline.findIndex(
            ({ type }) => type === 'db-cancel-received'
        );
        assert.notEqual(receiptIndex, -1);

        for (const receipt of [
            { requestId: 'another-request' },
            { operationId: 'another-operation' },
            { ipcCallId: 999 },
            { sourceEpochMs: 999 },
            {
                epochMs:
                    Number(raw.cancellation.authoritativeTerminalEpochMs) + 1,
            },
        ]) {
            const timeline = evidence.timeline.map((record, index) =>
                index === receiptIndex ? { ...record, ...receipt } : record
            );
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...raw,
                        cancellationEvidence: { timeline },
                    }),
                /invalid Xtream iteration/
            );
        }
        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    cancellationEvidence: {
                        timeline: evidence.timeline.map((record) => ({
                            ...record,
                            sourceEpochMs: record.sourceEpochMs + 1,
                        })),
                    },
                }),
            /invalid Xtream iteration/
        );
    });

    it('rejects reuse of a worker request IPC identity for cancellation', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const evidence = cancellationEvidence(raw);
        const failedRequest = raw.databaseWorker.requests.evidence.find(
            ({ operation, success }) =>
                operation === 'DB_SAVE_CONTENT' && !success
        );
        assert.ok(failedRequest?.ipcCallId);

        for (const ipcCallId of [failedRequest.ipcCallId, 999]) {
            assert.throws(
                () =>
                    assertXtreamIterationResult({
                        ...raw,
                        cancellationEvidence: {
                            timeline: evidence.timeline.map((record) => ({
                                ...record,
                                ipcCallId: ipcCallId as number,
                            })),
                        },
                    }),
                /invalid Xtream iteration/
            );
        }
    });

    it('persists producer identity on the database cancel IPC pair', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const databaseCancel = raw.phaseCapture.ipcSpans.filter(
            ({ method }) => method === 'dbCancelOperation'
        ) as readonly ((typeof raw.phaseCapture.ipcSpans)[number] & {
            readonly ipcCallId?: number;
            readonly sourceEpochMs?: number;
        })[];

        assert.equal(databaseCancel.length, 2);
        assert.equal(typeof databaseCancel[0]?.ipcCallId, 'number');
        assert.equal(
            databaseCancel[0]?.ipcCallId,
            databaseCancel[1]?.ipcCallId
        );
        assert.equal(typeof databaseCancel[0]?.sourceEpochMs, 'number');
        assert.equal(
            databaseCancel[0]?.sourceEpochMs,
            databaseCancel[1]?.sourceEpochMs
        );
    });

    it('rejects database preload identities swapped across worker operations', () => {
        const raw = createIteration();
        const contentRead = raw.phaseCapture.ipcSpans.find(
            ({ boundary, method }) =>
                boundary === 'request' && method === 'dbGetContent'
        );
        const contentWrite = raw.phaseCapture.ipcSpans.find(
            ({ boundary, method }) =>
                boundary === 'request' && method === 'dbSaveContent'
        );
        assert.ok(contentRead);
        assert.ok(contentWrite);
        const ipcSpans = raw.phaseCapture.ipcSpans.map((span) => {
            if (span.correlationId === contentRead.correlationId) {
                return {
                    ...span,
                    ipcCallId: contentWrite.ipcCallId,
                    sourceEpochMs: contentWrite.sourceEpochMs,
                };
            }
            return span.correlationId === contentWrite.correlationId
                ? {
                      ...span,
                      ipcCallId: contentRead.ipcCallId,
                      sourceEpochMs: contentRead.sourceEpochMs,
                  }
                : span;
        });

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    phaseCapture: { ...raw.phaseCapture, ipcSpans },
                }),
            /invalid Xtream iteration/
        );
    });

    it('rejects cancellation source chronology before an earlier worker call', () => {
        const raw = createIteration(XTREAM_SCENARIO_ID.CANCEL_IMPORT);
        const evidence = cancellationEvidence(raw);
        const lastWorkerCall = raw.databaseWorker.requests.evidence
            .filter(
                (request) =>
                    request.ipcCallId !== null && request.sourceEpochMs !== null
            )
            .sort(
                (left, right) =>
                    Number(right.ipcCallId) - Number(left.ipcCallId)
            )[0];
        assert.ok(lastWorkerCall?.sourceEpochMs);
        const databaseSourceEpochMs =
            Number(lastWorkerCall.sourceEpochMs) - 0.25;
        const networkSourceEpochMs = databaseSourceEpochMs - 0.25;
        const ipcSpans = raw.phaseCapture.ipcSpans.map((span) => {
            if (span.method === 'xtreamCancelSession') {
                return { ...span, sourceEpochMs: networkSourceEpochMs };
            }
            return span.method === 'dbCancelOperation'
                ? { ...span, sourceEpochMs: databaseSourceEpochMs }
                : span;
        });

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    cancellationEvidence: {
                        timeline: evidence.timeline.map((record) => ({
                            ...record,
                            sourceEpochMs: databaseSourceEpochMs,
                        })),
                    },
                    phaseCapture: { ...raw.phaseCapture, ipcSpans },
                }),
            /invalid Xtream iteration/
        );
    });

    it('ignores caller-owned phase array methods when checking evidence', () => {
        const raw = createIteration();
        const events = [
            ...raw.phaseCapture.events,
        ] as unknown as typeof raw.phaseCapture.events & {
            filter: () => readonly never[];
            map: () => readonly never[];
        };
        Object.defineProperties(events, {
            filter: { value: () => [] },
            map: { value: () => [] },
        });

        assert.throws(
            () =>
                assertXtreamIterationResult({
                    ...raw,
                    phaseCapture: { ...raw.phaseCapture, events },
                    phases: { ...raw.phases, sqliteWriteMs: 99 },
                }),
            /invalid Xtream iteration/
        );
    });
});

function withReceipt(
    raw: XtreamRawIterationResult,
    receiptEpochMs: number
): XtreamRawIterationResult {
    const click = Number(raw.cancellation.clickEpochMs);
    const evidence = cancellationEvidence(raw);
    return {
        ...raw,
        cancellation: {
            ...raw.cancellation,
            workerReceiptEpochMs: receiptEpochMs,
            workerReceiptLatencyMs: receiptEpochMs - click,
        },
        cancellationEvidence: {
            timeline: evidence.timeline.map((record) =>
                record.type === 'db-cancel-received'
                    ? { ...record, epochMs: receiptEpochMs }
                    : record
            ),
        },
    };
}

function cancellationEvidence(
    raw: XtreamRawIterationResult
): NonNullable<XtreamRawIterationResult['cancellationEvidence']> {
    const evidence = raw.cancellationEvidence;
    assert.ok(evidence);
    return evidence;
}

function createIteration(
    scenarioId: XtreamScenarioId = XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE
): XtreamRawIterationResult {
    const definition: XtreamIterationDefinition = {
        eligibleForComparison: true,
        kind: XTREAM_ITERATION_KIND.MEASURED,
        runId: 'run-01',
        scenarioId,
    };
    return iteration(definition, 1);
}
