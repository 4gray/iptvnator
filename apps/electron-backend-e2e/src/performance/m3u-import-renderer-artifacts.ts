import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';

import type { CDPSession } from '@playwright/test';

interface TraceData {
    readonly value: readonly unknown[];
}

export interface RendererHeapUsageSample {
    readonly epochMs: number;
    readonly usedSize: number;
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
    const traceOutput = tracePath
        ? createWriteStream(tracePath, { flags: 'wx', mode: 0o600 })
        : null;
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
                await finished(traceOutput);
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
            { encoding: 'utf8', flag: 'wx', mode: 0o600 }
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
        requirePath(path, 'renderer heap snapshot'),
        { flags: 'wx', mode: 0o600 }
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
        await finished(output);
    }
}

export function selectRendererPeakHeapUsedBytes(
    samples: readonly RendererHeapUsageSample[],
    measurementStartEpochMs: number,
    terminalEpochMs: number
): number {
    const inWindow = samples.filter(
        ({ epochMs, usedSize }) =>
            Number.isFinite(epochMs) &&
            epochMs >= measurementStartEpochMs &&
            epochMs <= terminalEpochMs &&
            Number.isFinite(usedSize) &&
            usedSize >= 0
    );
    if (inWindow.length === 0) {
        throw new Error('renderer-heap-window-empty');
    }
    return Math.max(...inWindow.map(({ usedSize }) => usedSize));
}

export function assertRendererMeasurementWindow(input: {
    readonly captureCutoffEpochMs: number;
    readonly measurementStartEpochMs: number;
    readonly operationStartEpochMs: number;
    readonly terminalEpochMs: number;
}): void {
    const epochs = Object.values(input);
    if (
        !epochs.every((epoch) => Number.isFinite(epoch) && epoch > 0) ||
        input.measurementStartEpochMs < input.operationStartEpochMs ||
        input.terminalEpochMs < input.measurementStartEpochMs ||
        input.captureCutoffEpochMs < input.terminalEpochMs
    ) {
        throw new Error('renderer-measurement-window-invalid');
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
