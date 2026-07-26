export type RendererProcessRssUnavailableReason =
    | 'renderer-os-pid-invalid'
    | 'renderer-process-identity-changed'
    | 'renderer-process-metric-ambiguous'
    | 'renderer-process-metric-creation-time-invalid'
    | 'renderer-process-metric-missing-at-start'
    | 'renderer-process-metric-missing-during-capture'
    | 'renderer-process-metric-type-invalid'
    | 'renderer-process-metric-working-set-invalid';

export interface RendererProcessIdentity {
    readonly creationTime: number;
    readonly pid: number;
}

export interface RendererProcessRssCapture {
    readonly identity: RendererProcessIdentity | null;
    readonly missingSampleCount: number;
    readonly peakRssBytes: number | null;
    readonly unavailableReason: RendererProcessRssUnavailableReason | null;
    readonly validSampleCount: number;
}

type JsonRecord = Record<string, unknown>;

const KIBIBYTE_BYTES = 1_024;
const MAX_WORKING_SET_KIB = Math.floor(
    Number.MAX_SAFE_INTEGER / KIBIBYTE_BYTES
);

function readRecord(value: unknown): JsonRecord | null {
    return typeof value === 'object' && value !== null
        ? (value as JsonRecord)
        : null;
}

function isValidOsPid(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function findPidCandidates(
    processMetrics: readonly unknown[],
    pid: number
): JsonRecord[] {
    return processMetrics
        .map((metric) => readRecord(metric))
        .filter(
            (metric): metric is JsonRecord =>
                metric !== null && metric['pid'] === pid
        );
}

function readMetric(metric: JsonRecord):
    | {
          readonly creationTime: number;
          readonly rssBytes: number;
      }
    | RendererProcessRssUnavailableReason {
    if (metric['type'] !== 'Tab' && metric['type'] !== 'Renderer') {
        return 'renderer-process-metric-type-invalid';
    }

    const creationTime = metric['creationTime'];
    if (
        typeof creationTime !== 'number' ||
        !Number.isFinite(creationTime) ||
        creationTime < 0
    ) {
        return 'renderer-process-metric-creation-time-invalid';
    }

    const memory = readRecord(metric['memory']);
    const workingSetSize = memory?.['workingSetSize'];
    if (
        !Number.isSafeInteger(workingSetSize) ||
        Number(workingSetSize) <= 0 ||
        Number(workingSetSize) > MAX_WORKING_SET_KIB
    ) {
        return 'renderer-process-metric-working-set-invalid';
    }

    return {
        creationTime,
        rssBytes: Number(workingSetSize) * KIBIBYTE_BYTES,
    };
}

function unavailableCapture(
    unavailableReason: RendererProcessRssUnavailableReason,
    options: {
        readonly identity?: RendererProcessIdentity | null;
        readonly missingSampleCount?: number;
        readonly validSampleCount?: number;
    } = {}
): RendererProcessRssCapture {
    return Object.freeze({
        identity: options.identity ?? null,
        missingSampleCount: options.missingSampleCount ?? 0,
        peakRssBytes: null,
        unavailableReason,
        validSampleCount: options.validSampleCount ?? 0,
    });
}

function invalidateCapture(
    capture: RendererProcessRssCapture,
    unavailableReason: RendererProcessRssUnavailableReason,
    missingSampleCount = capture.missingSampleCount
): RendererProcessRssCapture {
    return unavailableCapture(unavailableReason, {
        identity: capture.identity,
        missingSampleCount,
        validSampleCount: capture.validSampleCount,
    });
}

export function createRendererProcessRssCapture(
    webContentsOsPid: unknown,
    processMetrics: readonly unknown[]
): RendererProcessRssCapture {
    if (!isValidOsPid(webContentsOsPid)) {
        return unavailableCapture('renderer-os-pid-invalid');
    }

    const candidates = findPidCandidates(processMetrics, webContentsOsPid);
    if (candidates.length === 0) {
        return unavailableCapture('renderer-process-metric-missing-at-start', {
            missingSampleCount: 1,
        });
    }
    if (candidates.length !== 1) {
        return unavailableCapture('renderer-process-metric-ambiguous');
    }

    const metric = readMetric(candidates[0] as JsonRecord);
    if (typeof metric === 'string') {
        return unavailableCapture(metric);
    }

    return Object.freeze({
        identity: Object.freeze({
            creationTime: metric.creationTime,
            pid: webContentsOsPid,
        }),
        missingSampleCount: 0,
        peakRssBytes: metric.rssBytes,
        unavailableReason: null,
        validSampleCount: 1,
    });
}

export function captureRendererProcessRssSample(
    capture: RendererProcessRssCapture,
    webContentsOsPid: unknown,
    processMetrics: readonly unknown[]
): RendererProcessRssCapture {
    if (capture.unavailableReason !== null) {
        return capture;
    }
    if (!isValidOsPid(webContentsOsPid)) {
        return invalidateCapture(capture, 'renderer-os-pid-invalid');
    }

    const identity = capture.identity;
    if (identity === null || webContentsOsPid !== identity.pid) {
        return invalidateCapture(capture, 'renderer-process-identity-changed');
    }

    const candidates = findPidCandidates(processMetrics, webContentsOsPid);
    if (candidates.length === 0) {
        return invalidateCapture(
            capture,
            'renderer-process-metric-missing-during-capture',
            capture.missingSampleCount + 1
        );
    }
    if (candidates.length !== 1) {
        return invalidateCapture(capture, 'renderer-process-metric-ambiguous');
    }

    const metric = readMetric(candidates[0] as JsonRecord);
    if (typeof metric === 'string') {
        return invalidateCapture(capture, metric);
    }
    if (metric.creationTime !== identity.creationTime) {
        return invalidateCapture(capture, 'renderer-process-identity-changed');
    }

    return Object.freeze({
        identity,
        missingSampleCount: capture.missingSampleCount,
        peakRssBytes: Math.max(
            capture.peakRssBytes ?? metric.rssBytes,
            metric.rssBytes
        ),
        unavailableReason: null,
        validSampleCount: capture.validSampleCount + 1,
    });
}
