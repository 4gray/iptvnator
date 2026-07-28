/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createXtreamIterationDefinitions,
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import { iteration } from './xtream-benchmark-report.fixtures';
import { assertXtreamIterationResult } from './xtream-iteration-validity';
import type { XtreamRawIterationResult } from './xtream-summary-contract';
import { validXtreamWorkerRequestIdentity } from './xtream-worker-request-identity';

test('enforces producer-coherent request identities and source-to-worker chronology', () => {
    const raw = createRaw(XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE);
    assert.doesNotThrow(() => assertXtreamIterationResult(raw));

    const correlated = request(raw, 'DB_GET_CATEGORIES');
    const nonApplicable = request(raw, 'DB_GET_APP_STATE');
    const requiredOperationId = request(raw, 'DB_SAVE_CONTENT');
    const receivedEpochMs = requireEpoch(correlated.requestReceivedEpochMs);

    assert.equal(
        validXtreamWorkerRequestIdentity({
            ...correlated,
            sourceEpochMs: receivedEpochMs + 0.006,
        }),
        true
    );
    assert.equal(
        validXtreamWorkerRequestIdentity({
            ...correlated,
            sourceEpochMs: receivedEpochMs + 1,
        }),
        false
    );

    assert.equal(nonApplicable.ipcCallId, null);
    assert.equal(nonApplicable.operationId, null);
    assert.equal(
        nonApplicable.operationIdUnavailableReason,
        'preload-performance-marker-not-applicable'
    );
    assert.equal(nonApplicable.sourceEpochMs, null);

    const invalidRequests = [
        replaceRequest(raw, correlated, {
            ipcCallId: null,
            operationIdUnavailableReason:
                'preload-performance-marker-not-applicable',
            sourceEpochMs: null,
        }),
        replaceRequest(raw, nonApplicable, {
            ipcCallId: 900_001,
            operationId: 'forged-operation',
            operationIdUnavailableReason: null,
            sourceEpochMs:
                requireEpoch(nonApplicable.requestReceivedEpochMs) - 1,
        }),
        replaceRequest(raw, requiredOperationId, {
            operationId: null,
            operationIdUnavailableReason:
                'preload-performance-marker-uncorrelated',
        }),
        replaceRequest(raw, correlated, {
            operationId: 'forged-operation',
            operationIdUnavailableReason: null,
        }),
        replaceRequest(raw, correlated, {
            sourceEpochMs: receivedEpochMs + 1,
        }),
    ];

    for (const requests of invalidRequests) {
        assert.throws(
            () => assertXtreamIterationResult(withRequests(raw, requests)),
            /invalid Xtream iteration/
        );
    }
});

test('binds populated and empty playlist deletes to their real producer identities', () => {
    const raw = createRaw(XTREAM_SCENARIO_ID.DELETE_LARGE);
    const deletes = raw.databaseWorker.requests.evidence.filter(
        ({ operation }) => operation === 'DB_DELETE_PLAYLIST'
    );
    const populated = deletes.find(
        (candidate) =>
            JSON.stringify(requestItemCounts(candidate)) ===
            JSON.stringify([100_100, 100_101])
    );
    const emptyFollowUp = deletes.find(
        (candidate) =>
            JSON.stringify(requestItemCounts(candidate)) ===
            JSON.stringify([0, 1])
    );
    assert.ok(populated?.operationId);
    assert.ok(emptyFollowUp);

    const producerCoherent = replaceRequest(raw, emptyFollowUp, {
        operationId: null,
        operationIdUnavailableReason: null,
    });
    assert.doesNotThrow(() =>
        assertXtreamIterationResult(withRequests(raw, producerCoherent))
    );

    const missingPopulatedIdentity = replaceRequest(raw, populated, {
        operationId: null,
        operationIdUnavailableReason: null,
    });
    assert.throws(
        () =>
            assertXtreamIterationResult(
                withRequests(raw, missingPopulatedIdentity)
            ),
        /invalid Xtream iteration/
    );
    const fabricatedFollowUpIdentity = replaceRequest(raw, emptyFollowUp, {
        operationId: 'fabricated-follow-up-operation',
        operationIdUnavailableReason: null,
    });
    assert.throws(
        () =>
            assertXtreamIterationResult(
                withRequests(raw, fabricatedFollowUpIdentity)
            ),
        /invalid Xtream iteration/
    );
});

test('requires producer IPC IDs to preserve per-producer source chronology', () => {
    const raw = createRaw(XTREAM_SCENARIO_ID.DELETE_LARGE);
    const [first, second] = raw.databaseWorker.requests.evidence;
    assert.ok(first);
    assert.ok(second);
    assert.ok(first.ipcCallId !== null);
    assert.ok(second.ipcCallId !== null);
    assert.ok(first.sourceEpochMs !== null);
    assert.ok(second.sourceEpochMs !== null);
    const laterSourceEpochMs = first.sourceEpochMs + 0.25;
    const chronologicalRequests = raw.databaseWorker.requests.evidence.map(
        (candidate) =>
            candidate === second
                ? { ...candidate, sourceEpochMs: laterSourceEpochMs }
                : candidate
    );
    const chronologicalIpcSpans = raw.phaseCapture.ipcSpans.map((span) =>
        span.ipcCallId === second.ipcCallId
            ? { ...span, sourceEpochMs: laterSourceEpochMs }
            : span
    );
    const swapped = chronologicalRequests.map((candidate) => {
        if (candidate === first) {
            return { ...candidate, ipcCallId: second.ipcCallId };
        }
        return candidate.ipcCallId === second.ipcCallId
            ? { ...candidate, ipcCallId: first.ipcCallId }
            : candidate;
    });
    assert.throws(
        () =>
            assertXtreamIterationResult({
                ...withRequests(raw, swapped),
                phaseCapture: {
                    ...raw.phaseCapture,
                    ipcSpans: chronologicalIpcSpans,
                },
            }),
        /invalid Xtream iteration/
    );
    const gapped = raw.databaseWorker.requests.evidence.map(
        (candidate, index) => ({
            ...candidate,
            ipcCallId: index === 0 ? 10 : 30,
        })
    );
    const gappedIpcSpans = raw.phaseCapture.ipcSpans.map((span) => ({
        ...span,
        ipcCallId: span.ipcCallId === first.ipcCallId ? 10 : 30,
    }));
    assert.doesNotThrow(() =>
        assertXtreamIterationResult({
            ...withRequests(raw, gapped),
            phaseCapture: {
                ...raw.phaseCapture,
                ipcSpans: gappedIpcSpans,
            },
        })
    );

    const tied = raw.databaseWorker.requests.evidence.map((candidate) =>
        candidate === second
            ? { ...candidate, sourceEpochMs: first.sourceEpochMs }
            : candidate
    );
    const tiedIpcSpans = raw.phaseCapture.ipcSpans.map((span) =>
        span.ipcCallId === second.ipcCallId
            ? { ...span, sourceEpochMs: first.sourceEpochMs as number }
            : span
    );
    assert.doesNotThrow(() =>
        assertXtreamIterationResult({
            ...withRequests(raw, tied),
            phaseCapture: {
                ...raw.phaseCapture,
                ipcSpans: tiedIpcSpans,
            },
        })
    );
});

test('does not let caller-owned evidence methods hide a missing populated delete identity', () => {
    const raw = createRaw(XTREAM_SCENARIO_ID.DELETE_LARGE);
    const pristine = raw.databaseWorker.requests.evidence;
    const populated = pristine.find(
        (candidate) =>
            candidate.operation === 'DB_DELETE_PLAYLIST' &&
            JSON.stringify(requestItemCounts(candidate)) ===
                JSON.stringify([100_100, 100_101])
    );
    assert.ok(populated);
    const forged = replaceRequest(raw, populated, {
        operationId: null,
        operationIdUnavailableReason: null,
    });
    const invoked: string[] = [];
    for (const method of ['filter', 'flatMap', 'map', 'some'] as const) {
        Object.defineProperty(forged, method, {
            configurable: true,
            value(...args: unknown[]) {
                invoked.push(method);
                return Reflect.apply(Array.prototype[method], pristine, args);
            },
        });
    }

    assert.throws(
        () => assertXtreamIterationResult(withRequests(raw, forged)),
        /invalid Xtream iteration/
    );
    assert.deepEqual(invoked, []);
});

test('requires the database-worker isolate heap to fit inside main-process RSS only', () => {
    const raw = createRaw(XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE);

    assert.throws(
        () =>
            assertXtreamIterationResult({
                ...raw,
                databaseWorker: {
                    ...raw.databaseWorker,
                    peakHeapUsedBytes: raw.main.peakRssBytes + 1,
                },
            }),
        /invalid Xtream iteration/
    );
    assert.doesNotThrow(() =>
        assertXtreamIterationResult({
            ...raw,
            databaseWorker: {
                ...raw.databaseWorker,
                peakExternalBytes: raw.main.peakRssBytes + 1,
            },
        })
    );
});

function createRaw(scenarioId: XtreamScenarioId): XtreamRawIterationResult {
    const definition = createXtreamIterationDefinitions(false).find(
        (candidate) => candidate.scenarioId === scenarioId
    );
    assert.ok(definition);
    return iteration(definition, 1);
}

function request(raw: XtreamRawIterationResult, operation: string) {
    const value = raw.databaseWorker.requests.evidence.find(
        (candidate) => candidate.operation === operation
    );
    assert.ok(value);
    return value;
}

function replaceRequest(
    raw: XtreamRawIterationResult,
    target: (typeof raw.databaseWorker.requests.evidence)[number],
    replacement: Partial<typeof target>
) {
    return raw.databaseWorker.requests.evidence.map((candidate) =>
        candidate === target ? { ...candidate, ...replacement } : candidate
    );
}

function withRequests(
    raw: XtreamRawIterationResult,
    evidence: typeof raw.databaseWorker.requests.evidence
): XtreamRawIterationResult {
    return {
        ...raw,
        databaseWorker: {
            ...raw.databaseWorker,
            requests: { ...raw.databaseWorker.requests, evidence },
        },
    };
}

function requireEpoch(value: number | null): number {
    assert.ok(value !== null);
    return value;
}

function requestItemCounts(
    request: XtreamRawIterationResult['databaseWorker']['requests']['evidence'][number]
): readonly (number | null)[] {
    return request.phaseEvents
        .filter(({ boundary }) => boundary === 'end')
        .map(({ metadata }) => metadata?.itemCount ?? null);
}
