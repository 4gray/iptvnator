import {
    assertXtreamDiagnosticArtifactEvidence,
    type XtreamDiagnosticArtifactEvidence,
} from './xtream-diagnostic-artifacts';
import type {
    XtreamDiagnosticArtifactProvenance,
    XtreamValidatedIterationResult,
} from './xtream-summary-contract';

export function bindXtreamDiagnosticEvidence(
    iterations: readonly XtreamValidatedIterationResult[],
    evidenceByIteration: ReadonlyMap<
        XtreamValidatedIterationResult,
        XtreamDiagnosticArtifactEvidence
    >
): ReadonlyMap<
    XtreamValidatedIterationResult,
    XtreamDiagnosticArtifactEvidence
> {
    const diagnostic = iterations.filter(({ kind }) => kind === 'diagnostic');
    const evidenceEntries = snapshotEvidenceEntries(evidenceByIteration);
    if (evidenceEntries.length !== diagnostic.length) {
        invalidEvidence();
    }
    const diagnosticSet = new Set(diagnostic);
    const boundEvidence = new Map<
        XtreamValidatedIterationResult,
        XtreamDiagnosticArtifactEvidence
    >();
    for (const [iteration, evidence] of evidenceEntries) {
        if (!diagnosticSet.has(iteration)) {
            invalidEvidence();
        }
        try {
            assertXtreamDiagnosticArtifactEvidence(evidence);
        } catch {
            invalidEvidence();
        }
        if (
            iteration.processIdentity.profileDirectorySha256 !==
                evidence.directorySha256 ||
            iteration.renderer.cpuProfileDurationMicros !==
                evidence.profiles.renderer.durationMicros ||
            iteration.main.cpuProfileDurationMicros !==
                evidence.profiles.main.durationMicros ||
            iteration.databaseWorker.cpuProfileDurationMicros !==
                evidence.profiles.databaseWorker.durationMicros ||
            iteration.databaseWorker.ordinal !==
                evidence.profiles.databaseWorker.ordinal
        ) {
            invalidEvidence();
        }
        Map.prototype.set.call(boundEvidence, iteration, evidence);
    }
    if (
        diagnostic.some(
            (iteration) => !Map.prototype.has.call(boundEvidence, iteration)
        )
    ) {
        invalidEvidence();
    }
    return boundEvidence;
}

export function copyXtreamDiagnosticProvenance(
    evidence: XtreamDiagnosticArtifactEvidence
): XtreamDiagnosticArtifactProvenance {
    assertXtreamDiagnosticArtifactEvidence(evidence);
    return {
        artifacts: evidence.artifacts.map((artifact) => ({ ...artifact })),
        directorySha256: evidence.directorySha256,
    };
}

export function cloneXtreamSummaryValue<T>(value: T): T {
    return structuredClone(value);
}

function snapshotEvidenceEntries(
    value: ReadonlyMap<
        XtreamValidatedIterationResult,
        XtreamDiagnosticArtifactEvidence
    >
): readonly (readonly [
    XtreamValidatedIterationResult,
    XtreamDiagnosticArtifactEvidence,
])[] {
    try {
        if (!(value instanceof Map)) invalidEvidence();
        const sizeGetter = Object.getOwnPropertyDescriptor(
            Map.prototype,
            'size'
        )?.get;
        if (!sizeGetter) invalidEvidence();
        const size = Reflect.apply(sizeGetter, value, []) as unknown;
        const entries: [
            XtreamValidatedIterationResult,
            XtreamDiagnosticArtifactEvidence,
        ][] = [];
        Map.prototype.forEach.call(value, (evidence, iteration) => {
            entries.push([iteration, evidence]);
        });
        if (size !== entries.length) invalidEvidence();
        return entries;
    } catch {
        invalidEvidence();
    }
}

function invalidEvidence(): never {
    throw new Error('invalid Xtream diagnostic artifact evidence binding');
}
