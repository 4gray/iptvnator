import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CDPSession } from '@playwright/test';

interface TraceData {
    readonly value: readonly unknown[];
}

export interface RendererArtifactCapture {
    beginTraceOutput(): void;
    readonly cpuProfilePath: string | null;
    finishTraceOutput(): Promise<void>;
    readonly heapSnapshotPath: string | null;
    readonly onTraceComplete: () => void;
    readonly onTraceData: (data: TraceData) => void;
    readonly traceComplete: Promise<void>;
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
    let traceOutputOpened = false;
    let traceOutputFinish: Promise<void> | null = null;
    let traceFirstEvent = true;
    let completeTrace: (() => void) | null = null;
    const traceComplete = new Promise<void>((resolve) => {
        completeTrace = resolve;
    });
    return {
        beginTraceOutput: () => {
            if (
                traceOutput &&
                !traceOutputOpened &&
                traceOutputFinish === null
            ) {
                traceOutput.write('{"traceEvents":[');
                traceOutputOpened = true;
            }
        },
        cpuProfilePath: options.diagnostic
            ? join(options.outputDirectory, 'renderer.cpuprofile')
            : null,
        finishTraceOutput: () => {
            traceOutputFinish ??= (async () => {
                if (!traceOutput) {
                    return;
                }
                if (!traceOutputOpened) {
                    traceOutput.write('{"traceEvents":[');
                    traceOutputOpened = true;
                }
                if (!traceOutput.writableEnded) {
                    traceOutput.write(']}');
                    traceOutput.end();
                }
                if (!traceOutput.writableFinished) {
                    await once(traceOutput, 'finish');
                }
            })();
            return traceOutputFinish;
        },
        heapSnapshotPath: options.diagnostic
            ? join(options.outputDirectory, 'renderer.heapsnapshot')
            : null,
        onTraceComplete: () => {
            completeTrace?.();
            completeTrace = null;
        },
        onTraceData: (data) => {
            if (!traceOutputOpened || traceOutput?.writableEnded) {
                return;
            }
            for (const event of data.value) {
                traceOutput?.write(
                    `${traceFirstEvent ? '' : ','}${JSON.stringify(event)}`
                );
                traceFirstEvent = false;
            }
        },
        traceComplete,
        tracePath,
    };
}

export async function startRendererDiagnosticCapture(
    session: CDPSession,
    artifacts: RendererArtifactCapture
): Promise<void> {
    await session.send('Profiler.enable');
    await session.send('Profiler.start');
    artifacts.beginTraceOutput();
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
    try {
        const cpuProfile = await session.send('Profiler.stop');
        await writeFile(
            requirePath(artifacts.cpuProfilePath, 'renderer CPU profile'),
            JSON.stringify(cpuProfile['profile']),
            'utf8'
        );
        await session.send('Tracing.end');
        await artifacts.traceComplete;
    } finally {
        disposeRendererDiagnosticListeners(session, artifacts);
        await artifacts.finishTraceOutput();
    }
}

export async function disposeRendererDiagnosticCapture(
    session: CDPSession,
    artifacts: RendererArtifactCapture
): Promise<void> {
    disposeRendererDiagnosticListeners(session, artifacts);
    await artifacts.finishTraceOutput();
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
    try {
        await session.send('HeapProfiler.takeHeapSnapshot', {
            reportProgress: false,
        });
    } finally {
        session.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
        output.end();
        if (!output.writableFinished) {
            await once(output, 'finish');
        }
    }
}

function disposeRendererDiagnosticListeners(
    session: CDPSession,
    artifacts: RendererArtifactCapture
): void {
    session.off('Tracing.dataCollected', artifacts.onTraceData);
    session.off('Tracing.tracingComplete', artifacts.onTraceComplete);
    artifacts.onTraceComplete();
}

function requirePath(value: string | null, label: string): string {
    if (value === null) {
        throw new Error(`${label} path is unavailable`);
    }
    return value;
}
