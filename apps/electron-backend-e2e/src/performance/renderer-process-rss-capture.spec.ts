/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    captureRendererProcessRssSample,
    createRendererProcessRssCapture,
    type RendererProcessRssCapture,
    type RendererProcessRssUnavailableReason,
} from './renderer-process-rss-capture';

const RENDERER_PID = 42;
const RENDERER_CREATION_TIME = 1_721_234_567_890;

interface MetricOverrides {
    readonly creationTime?: unknown;
    readonly pid?: unknown;
    readonly type?: unknown;
    readonly workingSetSize?: unknown;
}

function metric(overrides: MetricOverrides = {}): unknown {
    return {
        creationTime:
            overrides.creationTime === undefined
                ? RENDERER_CREATION_TIME
                : overrides.creationTime,
        memory: {
            workingSetSize:
                overrides.workingSetSize === undefined
                    ? 1_234
                    : overrides.workingSetSize,
        },
        pid: overrides.pid === undefined ? RENDERER_PID : overrides.pid,
        type: overrides.type === undefined ? 'Tab' : overrides.type,
    };
}

function assertUnavailable(
    capture: RendererProcessRssCapture,
    unavailableReason: RendererProcessRssUnavailableReason,
    expected: {
        readonly identity: RendererProcessRssCapture['identity'];
        readonly missingSampleCount?: number;
        readonly validSampleCount?: number;
    }
): void {
    assert.deepEqual(capture, {
        identity: expected.identity,
        missingSampleCount: expected.missingSampleCount ?? 0,
        peakRssBytes: null,
        unavailableReason,
        validSampleCount: expected.validSampleCount ?? 0,
    });
}

test('binds only the exact BrowserWindow renderer identity and converts KiB to bytes once', () => {
    const capture = createRendererProcessRssCapture(RENDERER_PID, [
        metric({
            creationTime: RENDERER_CREATION_TIME + 1,
            pid: 900,
            type: 'Renderer',
            workingSetSize: 9_999_999,
        }),
        metric(),
    ]);

    assert.deepEqual(capture, {
        identity: {
            creationTime: RENDERER_CREATION_TIME,
            pid: RENDERER_PID,
        },
        missingSampleCount: 0,
        peakRssBytes: 1_263_616,
        unavailableReason: null,
        validSampleCount: 1,
    });
});

test('accepts only exact Tab or Renderer process types and tracks the peak without mutating prior state', () => {
    const initial = createRendererProcessRssCapture(RENDERER_PID, [
        metric({ type: 'Tab', workingSetSize: 2_000 }),
    ]);
    const lower = captureRendererProcessRssSample(initial, RENDERER_PID, [
        metric({ type: 'Renderer', workingSetSize: 1_500 }),
        metric({
            pid: 777,
            type: 'Renderer',
            workingSetSize: 8_000_000,
        }),
    ]);

    assert.equal(initial.validSampleCount, 1);
    assert.equal(initial.peakRssBytes, 2_048_000);
    assert.deepEqual(lower, {
        identity: {
            creationTime: RENDERER_CREATION_TIME,
            pid: RENDERER_PID,
        },
        missingSampleCount: 0,
        peakRssBytes: 2_048_000,
        unavailableReason: null,
        validSampleCount: 2,
    });

    const higher = captureRendererProcessRssSample(lower, RENDERER_PID, [
        metric({ workingSetSize: 2_500 }),
    ]);
    assert.equal(higher.peakRssBytes, 2_560_000);
    assert.equal(higher.validSampleCount, 3);
});

test('fails closed when the BrowserWindow OS process id is invalid', () => {
    for (const invalidPid of [0, -1, 1.5, Number.NaN, '42'] as const) {
        assertUnavailable(
            createRendererProcessRssCapture(invalidPid, [metric()]),
            'renderer-os-pid-invalid',
            { identity: null }
        );
    }
});

test('fails closed when the initial target metric is missing or ambiguous', () => {
    assertUnavailable(
        createRendererProcessRssCapture(RENDERER_PID, [
            metric({ pid: 99, workingSetSize: 99_999 }),
        ]),
        'renderer-process-metric-missing-at-start',
        {
            identity: null,
            missingSampleCount: 1,
        }
    );

    assertUnavailable(
        createRendererProcessRssCapture(RENDERER_PID, [
            metric(),
            metric({ type: 'Renderer', workingSetSize: 2_000 }),
        ]),
        'renderer-process-metric-ambiguous',
        { identity: null }
    );
});

test('fails closed for invalid initial type, creation time, or working set', () => {
    const cases: ReadonlyArray<{
        readonly metric: unknown;
        readonly reason: RendererProcessRssUnavailableReason;
    }> = [
        {
            metric: metric({ type: 'RendererHelper' }),
            reason: 'renderer-process-metric-type-invalid',
        },
        {
            metric: metric({ creationTime: '1721234567890' }),
            reason: 'renderer-process-metric-creation-time-invalid',
        },
        {
            metric: metric({ workingSetSize: Number.POSITIVE_INFINITY }),
            reason: 'renderer-process-metric-working-set-invalid',
        },
        {
            metric: metric({ workingSetSize: 0 }),
            reason: 'renderer-process-metric-working-set-invalid',
        },
    ];

    for (const testCase of cases) {
        assertUnavailable(
            createRendererProcessRssCapture(RENDERER_PID, [testCase.metric]),
            testCase.reason,
            { identity: null }
        );
    }
});

test('invalidates the capture when the bound renderer is missing and never recovers', () => {
    const initial = createRendererProcessRssCapture(RENDERER_PID, [metric()]);
    const missing = captureRendererProcessRssSample(initial, RENDERER_PID, [
        metric({ pid: 700, workingSetSize: 9_999_999 }),
    ]);

    assertUnavailable(
        missing,
        'renderer-process-metric-missing-during-capture',
        {
            identity: initial.identity,
            missingSampleCount: 1,
            validSampleCount: 1,
        }
    );

    const laterValid = captureRendererProcessRssSample(missing, RENDERER_PID, [
        metric({ workingSetSize: 5_000 }),
    ]);
    assert.deepEqual(laterValid, missing);
});

test('invalidates the capture when the BrowserWindow or process metric identity changes', () => {
    const initial = createRendererProcessRssCapture(RENDERER_PID, [metric()]);

    assertUnavailable(
        captureRendererProcessRssSample(initial, 43, [
            metric({
                creationTime: RENDERER_CREATION_TIME + 1,
                pid: 43,
            }),
        ]),
        'renderer-process-identity-changed',
        {
            identity: initial.identity,
            validSampleCount: 1,
        }
    );

    assertUnavailable(
        captureRendererProcessRssSample(initial, RENDERER_PID, [
            metric({ creationTime: RENDERER_CREATION_TIME + 1 }),
        ]),
        'renderer-process-identity-changed',
        {
            identity: initial.identity,
            validSampleCount: 1,
        }
    );
});

test('fails closed for invalid or ambiguous metrics after binding', () => {
    const initial = createRendererProcessRssCapture(RENDERER_PID, [metric()]);
    const cases: ReadonlyArray<{
        readonly metrics: readonly unknown[];
        readonly reason: RendererProcessRssUnavailableReason;
    }> = [
        {
            metrics: [metric(), metric({ type: 'Renderer' })],
            reason: 'renderer-process-metric-ambiguous',
        },
        {
            metrics: [metric({ type: 'RendererHelper' })],
            reason: 'renderer-process-metric-type-invalid',
        },
        {
            metrics: [metric({ creationTime: Number.NaN })],
            reason: 'renderer-process-metric-creation-time-invalid',
        },
        {
            metrics: [metric({ workingSetSize: -1 })],
            reason: 'renderer-process-metric-working-set-invalid',
        },
    ];

    for (const testCase of cases) {
        assertUnavailable(
            captureRendererProcessRssSample(
                initial,
                RENDERER_PID,
                testCase.metrics
            ),
            testCase.reason,
            {
                identity: initial.identity,
                validSampleCount: 1,
            }
        );
    }
});

test('keeps invalid renderer PIDs sticky after binding', () => {
    const initial = createRendererProcessRssCapture(RENDERER_PID, [metric()]);
    const invalid = captureRendererProcessRssSample(initial, 0, [metric()]);

    assertUnavailable(invalid, 'renderer-os-pid-invalid', {
        identity: initial.identity,
        validSampleCount: 1,
    });
    assert.deepEqual(
        captureRendererProcessRssSample(invalid, RENDERER_PID, [metric()]),
        invalid
    );
});
