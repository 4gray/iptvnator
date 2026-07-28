export type XtreamBenchmarkFailureStage =
    | 'background-ui'
    | 'capture-setup'
    | 'capture-stop'
    | 'evidence-validation'
    | 'measured-capture-start'
    | 'operation-trigger'
    | 'renderer-capture-start'
    | 'result-persistence'
    | 'scenario-preparation'
    | 'seed'
    | 'terminal-settlement';

type FailureEvidenceName =
    | 'control'
    | 'mainCapture'
    | 'mainStatus'
    | 'rendererCapture'
    | 'terminal'
    | 'trigger';

type FailureEvidenceStatus = 'capture-failed' | 'captured' | 'not-available';

interface PersistXtreamIterationFailureEvidenceOptions {
    readonly evidence: Partial<
        Record<FailureEvidenceName, () => Promise<unknown>>
    >;
    readonly persist: (filename: string, value: unknown) => Promise<void>;
    readonly stage: XtreamBenchmarkFailureStage;
}

const EVIDENCE_ARTIFACTS: readonly [FailureEvidenceName, string][] =
    Object.freeze([
        ['mainStatus', 'failure-main-status.json'],
        ['mainCapture', 'failure-main-capture.json'],
        ['rendererCapture', 'failure-renderer-capture.json'],
        ['trigger', 'failure-trigger-evidence.json'],
        ['terminal', 'failure-terminal-evidence.json'],
        ['control', 'failure-control-state.json'],
    ]);

export function createXtreamSingleAttemptCapture<T>(
    capture: () => Promise<T>
): () => Promise<T> {
    let attempt: Promise<T> | null = null;
    return () => {
        attempt ??= Promise.resolve().then(capture);
        return attempt;
    };
}

export async function persistXtreamIterationFailureEvidence(
    options: PersistXtreamIterationFailureEvidenceOptions
): Promise<void> {
    const status = {} as Record<FailureEvidenceName, FailureEvidenceStatus>;
    for (const [name, filename] of EVIDENCE_ARTIFACTS) {
        const capture = options.evidence[name];
        if (!capture) {
            status[name] = 'not-available';
            continue;
        }
        try {
            const value = await capture();
            await options.persist(filename, value);
            status[name] = 'captured';
        } catch {
            status[name] = 'capture-failed';
        }
    }
    await options
        .persist('failure.json', {
            evidence: status,
            reason: 'xtream-benchmark-iteration-failed',
            stage: options.stage,
            status: 'failed',
            validForComparison: false,
        })
        .catch(() => undefined);
}
