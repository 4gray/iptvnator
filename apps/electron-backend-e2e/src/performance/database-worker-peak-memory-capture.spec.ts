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

test('counts only finite nonnegative worker heap and external-memory samples per capture generation', () => {
    const workerRecord = section(
        'interface WorkerRecord',
        'interface TimelineRecord'
    );
    const createRecord = section(
        'const record: WorkerRecord = {',
        'nextWorkerOrdinal += 1'
    );
    const sampleWorker = section(
        'const sampleWorker =',
        'const resetWorkerForCapture'
    );
    const resetWorker = section(
        'const resetWorkerForCapture',
        'const startWorker'
    );

    assert.match(workerRecord, /externalMemorySampleCount: number/);
    assert.match(workerRecord, /heapUsedSampleCount: number/);
    assert.match(createRecord, /externalMemorySampleCount: 0/);
    assert.match(createRecord, /heapUsedSampleCount: 0/);
    assert.match(resetWorker, /record\.externalMemorySampleCount = 0/);
    assert.match(resetWorker, /record\.heapUsedSampleCount = 0/);

    assert.match(sampleWorker, /const heapUsedSample = stats\.used_heap_size/);
    assert.match(
        sampleWorker,
        /Number\.isFinite\(heapUsedSample\)[\s\S]*heapUsedSample >= 0/
    );
    assert.match(sampleWorker, /record\.heapUsedSampleCount \+= 1/);
    assert.match(
        sampleWorker,
        /const externalMemorySample = stats\.external_memory/
    );
    assert.match(
        sampleWorker,
        /Number\.isFinite\(externalMemorySample\)[\s\S]*externalMemorySample >= 0/
    );
    assert.match(sampleWorker, /record\.externalMemorySampleCount \+= 1/);
    assert.doesNotMatch(sampleWorker, /used_heap_size \?\? 0/);
    assert.doesNotMatch(sampleWorker, /external_memory \?\? 0/);
});

test('raw worker metrics distinguish missing samples from measured zero-byte peaks', () => {
    const transport = section(
        'const workers = currentWorkerRecords',
        'const transport: MainCaptureGenerationTransport'
    );

    assert.match(
        transport,
        /externalMemorySampleCount:\s*record\.externalMemorySampleCount/
    );
    assert.match(
        transport,
        /heapUsedSampleCount:\s*record\.heapUsedSampleCount/
    );
    assert.match(
        transport,
        /peakExternalBytes:\s*record\.externalMemorySampleCount > 0[\s\S]*\?\s*record\.externalPeak[\s\S]*:\s*null/
    );
    assert.match(
        transport,
        /peakHeapUsedBytes:\s*record\.heapUsedSampleCount > 0[\s\S]*\?\s*record\.heapPeak[\s\S]*:\s*null/
    );
    assert.match(
        transport,
        /peakExternalUnavailableReason:\s*record\.externalMemorySampleCount > 0[\s\S]*\?\s*null[\s\S]*:\s*'worker-external-memory-samples-missing'/
    );
    assert.match(
        transport,
        /peakHeapUsedUnavailableReason:\s*record\.heapUsedSampleCount > 0[\s\S]*\?\s*null[\s\S]*:\s*'worker-heap-used-samples-missing'/
    );
    assert.doesNotMatch(
        transport,
        /peakExternalBytes: record\.externalPeak[,}]/
    );
    assert.doesNotMatch(transport, /peakHeapUsedBytes: record\.heapPeak[,}]/);
});
