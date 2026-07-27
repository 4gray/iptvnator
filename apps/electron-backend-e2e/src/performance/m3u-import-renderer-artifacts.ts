import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CDPSession } from '@playwright/test';

interface TraceData {
    readonly value: readonly unknown[];
}

export interface RendererArtifactCapture {
    readonly cpuProfilePath: string | null;
    readonly heapSnapshotPath: string | null;
    readonly onTraceComplete: () => void;
    readonly onTraceData: (data: TraceData) => void;
    readonly traceComplete: Promise<void>;
    readonly traceOutput: ReturnType<typeof createWriteStream> | null;
    readonly tracePath: string | null;
}

export function createRendererArtifactCapture(options: {
    readonly diagnostic: boolean;
    readonly outputDirectory: string;
}): RendererArtifactCapture {
    const tracePath = options.diagnostic
        ? join(options.outputDirectory, 'renderer.trace.json')
        : null;
    const traceOutput = tracePath ? createWriteStream(tracePath) : null;
    let traceFirstEvent = true;
    let completeTrace: (() => void) | null = null;
    const traceComplete = new Promise<void>((resolve) => {
        completeTrace = resolve;
    });
    return {
        cpuProfilePath: options.diagnostic
            ? join(options.outputDirectory, 'renderer.cpuprofile')
            : null,
        heapSnapshotPath: options.diagnostic
            ? join(options.outputDirectory, 'renderer.heapsnapshot')
            : null,
        onTraceComplete: () => {
            completeTrace?.();
            completeTrace = null;
        },
        onTraceData: (data) => {
            for (const event of data.value) {
                traceOutput?.write(
                    `${traceFirstEvent ? '' : ','}${JSON.stringify(event)}`
                );
                traceFirstEvent = false;
            }
        },
        traceComplete,
        traceOutput,
        tracePath,
    };
}

export async function startRendererDiagnosticCapture(
    session: CDPSession,
    artifacts: RendererArtifactCapture
): Promise<void> {
    await session.send('Profiler.enable');
    await session.send('Profiler.start');
    artifacts.traceOutput?.write('{"traceEvents":[');
    session.on('Tracing.dataCollected', artifacts.onTraceData);
    session.on('Tracing.tracingComplete', artifacts.onTraceComplete);
    await session.send('Tracing.start', {
        categories: [
            'blink.user_timing',
            'devtools.timeline',
            'disabled-by-default-devtools.timeline',
            'disabled-by-default-v8.cpu_profiler',
            'v8',
        ].join(','),
        options: 'sampling-frequency=1000',
        transferMode: 'ReportEvents',
    });
}

export async function stopRendererDiagnosticCapture(
    session: CDPSession,
    artifacts: RendererArtifactCapture
): Promise<void> {
    const cpuProfile = await session.send('Profiler.stop');
    await writeFile(
        requirePath(artifacts.cpuProfilePath, 'renderer CPU profile'),
        JSON.stringify(cpuProfile['profile']),
        'utf8'
    );
    await session.send('Tracing.end');
    await artifacts.traceComplete;
    session.off('Tracing.dataCollected', artifacts.onTraceData);
    session.off('Tracing.tracingComplete', artifacts.onTraceComplete);
    artifacts.traceOutput?.write(']}');
    artifacts.traceOutput?.end();
    if (artifacts.traceOutput) {
        await once(artifacts.traceOutput, 'finish');
    }
}

export async function takeRendererHeapSnapshot(
    session: CDPSession,
    path: string | null
): Promise<void> {
    const output = createWriteStream(
        requirePath(path, 'renderer heap snapshot')
    );
    const onChunk = ({ chunk }: { readonly chunk: string }): void => {
        output.write(chunk);
    };
    session.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await session.send('HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
    });
    session.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    output.end();
    await once(output, 'finish');
}

function requirePath(value: string | null, label: string): string {
    if (value === null) {
        throw new Error(`${label} path is unavailable`);
    }
    return value;
}
