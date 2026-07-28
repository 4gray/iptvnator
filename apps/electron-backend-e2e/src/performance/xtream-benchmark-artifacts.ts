import { join } from 'node:path';

import {
    serializeXtreamArtifactForPersistence,
    type XtreamDiagnosticArtifactEvidence,
} from './xtream-diagnostic-artifacts';
import { writeXtreamExclusiveArtifact } from './xtream-exclusive-artifact-writer';
import { persistThenValidateXtreamIteration } from './xtream-benchmark-report';
import { XTREAM_SYNTHETIC_CREDENTIALS } from './xtream-scenario-driver';
import type {
    XtreamArtifactSafetyContext,
    XtreamRawIterationResult,
    XtreamValidatedIterationResult,
} from './xtream-summary-contract';

export interface PersistedXtreamIteration {
    readonly diagnosticEvidence: XtreamDiagnosticArtifactEvidence | null;
    readonly iteration: XtreamValidatedIterationResult;
}

export function createXtreamArtifactSafetyContext(
    controlToken: string
): XtreamArtifactSafetyContext {
    return Object.freeze({
        controlToken,
        syntheticCredentials: XTREAM_SYNTHETIC_CREDENTIALS,
    });
}

export async function writeXtreamSafeJson(
    absolutePath: string,
    value: unknown,
    safety: XtreamArtifactSafetyContext
): Promise<void> {
    const serialized = serializeXtreamArtifactForPersistence(value, safety);
    await writeXtreamExclusiveArtifact(absolutePath, serialized);
}

export async function persistXtreamIteration(
    iterationDirectory: string,
    raw: XtreamRawIterationResult,
    diagnosticEvidence: XtreamDiagnosticArtifactEvidence | null,
    safety: XtreamArtifactSafetyContext
): Promise<PersistedXtreamIteration> {
    const iteration = await persistThenValidateXtreamIteration(
        raw,
        safety,
        (serialized) =>
            writeXtreamExclusiveArtifact(
                join(iterationDirectory, 'result.json'),
                serialized
            )
    );
    return Object.freeze({ diagnosticEvidence, iteration });
}
