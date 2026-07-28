import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    createXtreamIterationDefinitions,
    XTREAM_SCENARIO_ID,
} from './xtream-benchmark-contract';
import { iteration } from './xtream-benchmark-report.fixtures';
import type { XtreamWorkerRequestAccounting } from './xtream-summary-contract';
import { validXtreamWorkerRequestAccounting } from './xtream-worker-request-evidence';

describe('Xtream worker request canonical snapshot', () => {
    it('rejects an accessor-backed request record without invoking it', () => {
        const requests = deleteAccounting();
        const target = required(requests.evidence, 0);
        const forged = { ...target };
        const invoked: string[] = [];
        Object.defineProperty(forged, 'operation', {
            enumerable: true,
            get() {
                invoked.push('request.operation');
                return target.operation;
            },
        });

        assert.equal(
            validXtreamWorkerRequestAccounting(
                withRequest(requests, target, forged),
                XTREAM_SCENARIO_ID.DELETE_LARGE
            ),
            false
        );
        assert.deepEqual(invoked, []);
    });

    it('rejects caller-owned nested phase array methods without invoking them', () => {
        const requests = deleteAccounting();
        const target = required(requests.evidence, 0);
        const phaseEvents = [...target.phaseEvents];
        const invoked: string[] = [];
        for (const method of ['filter', 'flatMap', 'map', 'some'] as const) {
            Object.defineProperty(phaseEvents, method, {
                configurable: true,
                value(...args: unknown[]) {
                    invoked.push(method);
                    return Reflect.apply(
                        Array.prototype[method],
                        target.phaseEvents,
                        args
                    );
                },
            });
        }
        const forged = { ...target, phaseEvents };

        assert.equal(
            validXtreamWorkerRequestAccounting(
                withRequest(requests, target, forged),
                XTREAM_SCENARIO_ID.DELETE_LARGE
            ),
            false
        );
        assert.deepEqual(invoked, []);
    });
});

function deleteAccounting(): XtreamWorkerRequestAccounting {
    const definition = createXtreamIterationDefinitions(false).find(
        ({ scenarioId }) => scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE
    );
    assert.ok(definition);
    return iteration(definition, 1).databaseWorker.requests;
}

function withRequest(
    accounting: XtreamWorkerRequestAccounting,
    target: XtreamWorkerRequestAccounting['evidence'][number],
    replacement: XtreamWorkerRequestAccounting['evidence'][number]
): XtreamWorkerRequestAccounting {
    return {
        ...accounting,
        evidence: accounting.evidence.map((request) =>
            request === target ? replacement : request
        ),
    };
}

function required<T>(values: readonly T[], index: number): T {
    const value = values[index];
    assert.ok(value);
    return value;
}
