/* eslint-disable playwright/expect-expect -- This is a Node assertion-based performance contract test. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('./m3u-refresh-main-capture.ts', import.meta.url),
    'utf8'
);

function section(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0, `missing start marker: ${startMarker}`);
    assert.ok(end > start, `missing end marker: ${endMarker}`);
    return source.slice(start, end);
}

test('samples main and worker memory from one shared interval scheduler', () => {
    const workerRecord = section(
        'interface WorkerRecord',
        'interface TimelineRecord'
    );
    const resetWorker = section(
        'const resetWorkerForCapture',
        'const startWorker'
    );
    const startWorker = section(
        'const startWorker',
        'const stopWorkerSampling'
    );
    const stopWorker = section(
        'const stopWorkerSampling',
        'const joinFinalWorkerSample'
    );
    const joinFinalWorker = section(
        'const joinFinalWorkerSample',
        'const stopWorkerProfile'
    );
    const sampleMain = section('const sampleMain', 'const startCapture');
    const beginMeasurement = section(
        'const beginMeasurement = async',
        'const startCapture'
    );
    const armCapture = section('const startCapture', 'const api =');
    const stopCapture = section(
        'stop: async (',
        'xtreamStatus: (): XtreamMainCaptureStatus'
    );

    assert.match(workerRecord, /samplingStarted: boolean/);
    assert.doesNotMatch(workerRecord, /sampleTimer/);
    assert.match(resetWorker, /record\.samplingStarted = false/);
    assert.match(startWorker, /if \(record\.samplingStarted\)/);
    assert.match(
        startWorker,
        /record\.samplingStarted = true[\s\S]*const initialSample = sampleWorker\(record\)/
    );
    assert.doesNotMatch(startWorker, /setInterval/);
    assert.match(stopWorker, /record\.samplingStarted = false/);
    assert.match(joinFinalWorker, /await sampleWorker\(record\)/);
    assert.match(
        sampleMain,
        /for \(const record of records\.values\(\)\)[\s\S]*record\.samplingStarted &&[\s\S]*isCurrentCaptureRecord\(record\)[\s\S]*void sampleWorker\(record\)/
    );
    assert.match(
        beginMeasurement,
        /sampleMain\(\)[\s\S]*state\.sampleTimer = setInterval\(sampleMain, 20\)/
    );
    assert.doesNotMatch(armCapture, /setInterval\(sampleMain/);
    assert.match(
        stopCapture,
        /clearInterval\(state\.sampleTimer\)[\s\S]*state\.sampleTimer = null[\s\S]*await startCapture\(nextOptions\)/
    );

    assert.equal(
        source.match(/\bsetInterval\s*\(/g)?.length,
        1,
        'the injected main capture must own exactly one interval timer'
    );
});
