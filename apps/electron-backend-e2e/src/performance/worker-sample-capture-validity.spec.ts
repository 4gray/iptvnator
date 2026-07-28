/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface WorkerSampleDeadlineModule {
    assertWorkerSampleCaptureValid?: (
        invalidReasons: readonly string[]
    ) => void;
}

const modulePromise = import(
    new URL('./worker-sample-deadline.ts', import.meta.url).href
).then((module) => module as WorkerSampleDeadlineModule);

test('rejects a timed-out worker sample before returning plain capture metrics', async () => {
    const module = await modulePromise;
    const assertCaptureValid = module.assertWorkerSampleCaptureValid;
    assert.equal(typeof assertCaptureValid, 'function');

    assert.doesNotThrow(() => assertCaptureValid?.([]));
    assert.throws(
        () => assertCaptureValid?.(['worker-sample-timeout']),
        /main-capture-worker-sample-timeout/
    );
});

test('plain capture stop and rollover both enforce worker sample validity', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-main-capture.ts', import.meta.url),
        'utf8'
    );
    const rolloverStart = source.indexOf(
        'export async function rolloverMainCapture'
    );
    const stopStart = source.indexOf('export async function stopMainCapture');
    const xtreamRolloverStart = source.indexOf(
        'export async function rolloverXtreamMainCapture'
    );
    const rollover = source.slice(rolloverStart, stopStart);
    const stop = source.slice(stopStart, xtreamRolloverStart);

    assert.match(
        rollover,
        /assertWorkerSampleCaptureValid\(transport\.xtream\.invalidReasons\)/
    );
    assert.match(
        stop,
        /assertWorkerSampleCaptureValid\(transport\.xtream\.invalidReasons\)/
    );
});
