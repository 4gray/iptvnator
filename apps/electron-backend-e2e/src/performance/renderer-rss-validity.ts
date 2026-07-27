import type { RendererProcessRssCapture } from './renderer-process-rss-capture';

export interface RendererRssValidityIteration {
    readonly kind: string;
    readonly main: {
        readonly rendererWindow: {
            readonly rss: RendererProcessRssCapture;
        };
    };
    readonly runId: string;
}

export interface InvalidRendererRssMeasuredRun {
    readonly missingSampleCount: number;
    readonly reason:
        | Exclude<RendererProcessRssCapture['unavailableReason'], null>
        | 'renderer-rss-capture-invalid';
    readonly runId: string;
    readonly validSampleCount: number;
}

export interface RendererRssValidity {
    readonly invalidMeasuredRuns: readonly InvalidRendererRssMeasuredRun[];
    readonly measuredRunCount: number;
    readonly validForBenchmark: boolean;
    readonly validForComparison: boolean;
    readonly validMeasuredRunCount: number;
}

export function assessRendererRssValidity(
    iterations: readonly RendererRssValidityIteration[]
): RendererRssValidity {
    const measured = iterations.filter(
        (iteration) => iteration.kind === 'measured'
    );
    const invalidMeasuredRuns: RendererRssValidity['invalidMeasuredRuns'][number][] =
        [];
    let validMeasuredRunCount = 0;

    for (const iteration of measured) {
        const rss = iteration.main.rendererWindow.rss;
        if (
            rss.identity !== null &&
            Number.isSafeInteger(rss.peakRssBytes) &&
            Number(rss.peakRssBytes) > 0 &&
            rss.unavailableReason === null &&
            rss.missingSampleCount === 0 &&
            Number.isSafeInteger(rss.validSampleCount) &&
            rss.validSampleCount > 0
        ) {
            validMeasuredRunCount += 1;
            continue;
        }

        invalidMeasuredRuns.push({
            missingSampleCount: rss.missingSampleCount,
            reason: rss.unavailableReason ?? 'renderer-rss-capture-invalid',
            runId: iteration.runId,
            validSampleCount: rss.validSampleCount,
        });
    }

    const valid =
        measured.length > 0 && validMeasuredRunCount === measured.length;
    return Object.freeze({
        invalidMeasuredRuns: Object.freeze(invalidMeasuredRuns),
        measuredRunCount: measured.length,
        validForBenchmark: valid,
        validForComparison: valid,
        validMeasuredRunCount,
    });
}
