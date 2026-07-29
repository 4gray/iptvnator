/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

interface HeartbeatModule {
    assertFixedGridRendererHeartbeatCoverage?: (
        heartbeatDelaysMs: readonly number[],
        operationStartEpochMs: number,
        terminalEpochMs: number
    ) => void;
    recordFixedGridRendererHeartbeats?: (
        page: unknown,
        stateKey: string,
        firstDeadlineEpochMs: number,
        unavailableError: string
    ) => Promise<number>;
}

const moduleUrl = new URL(
    './renderer-heartbeat-fixed-grid.ts',
    import.meta.url
);
const modulePromise = import(moduleUrl.href)
    .then((module) => module as HeartbeatModule)
    .catch(() => null);

test('fails closed when a fixed-grid renderer heartbeat deadline is omitted', async () => {
    const module = await modulePromise;
    assert.ok(module?.assertFixedGridRendererHeartbeatCoverage);

    assert.doesNotThrow(() =>
        module.assertFixedGridRendererHeartbeatCoverage?.(
            [101, 51, 1],
            100,
            251
        )
    );
    assert.throws(
        () =>
            module.assertFixedGridRendererHeartbeatCoverage?.(
                [101, 1],
                100,
                251
            ),
        /renderer-heartbeat-grid-incomplete:2\/3/
    );
    assert.throws(
        () =>
            module.assertFixedGridRendererHeartbeatCoverage?.(
                [101, 51, 1, 0],
                100,
                251
            ),
        /renderer-heartbeat-grid-incomplete:4\/3/
    );
});

test('keeps the first deadline unrecorded when the operation ends before it', async () => {
    const module = await modulePromise;
    assert.ok(module?.recordFixedGridRendererHeartbeats);
    const stateKey = '__fixedGridShortOperation';
    const target = globalThis as unknown as Record<string, unknown>;
    const performanceDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'performance'
    );
    target[stateKey] = {
        heartbeatDelaysMs: [],
        operationStartEpochMs: 100,
        terminalEpochMs: 149,
    };
    Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: { now: () => 200, timeOrigin: 0 },
    });
    const page = {
        evaluate: async (
            callback: (argument: unknown) => unknown,
            argument: unknown
        ) => callback(argument),
    };

    try {
        const nextDeadline =
            await module.recordFixedGridRendererHeartbeats(
                page,
                stateKey,
                150,
                'synthetic-unavailable'
            );
        assert.equal(nextDeadline, 150);
        assert.deepEqual(
            (
                target[stateKey] as {
                    heartbeatDelaysMs: number[];
                }
            ).heartbeatDelaysMs,
            []
        );
    } finally {
        delete target[stateKey];
        restoreGlobal('performance', performanceDescriptor);
    }
});

function restoreGlobal(
    key: string,
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
    } else {
        Reflect.deleteProperty(globalThis, key);
    }
}
