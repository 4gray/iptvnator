import { createHash } from 'node:crypto';

import type { XtreamIterationDefinition } from './xtream-benchmark-contract';
import {
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
} from './xtream-benchmark-contract';
import type { XtreamCatalogVerification } from './xtream-catalog-database-verification';
import {
    assertXtreamDiagnosticArtifactEvidence,
    type XtreamDiagnosticArtifactEvidence,
} from './xtream-diagnostic-artifacts';
import { freezeDeep } from './xtream-exact-schema';
import {
    assertXtreamMainEvidenceGates,
    createXtreamDatabaseWorkerMetrics,
    createXtreamMainMetrics,
    createXtreamRendererMetrics,
} from './xtream-iteration-assembly-metrics';
import { deriveXtreamPhaseCapture } from './xtream-iteration-assembly-phases';
import { assembleXtreamScenarioEvidence } from './xtream-iteration-assembly-scenarios';
import { assertXtreamIterationEvidenceBinding } from './xtream-iteration-evidence-binding';
import { assertXtreamIterationResult } from './xtream-iteration-validity';
import type { XtreamMainCaptureResult } from './m3u-refresh-main-capture';
import { attributeXtreamPhases } from './xtream-phase-attribution';
import type { XtreamRendererCaptureMetrics } from './xtream-renderer-capture';
import { validXtreamRendererConsoleErrorEvidence } from './xtream-renderer-console-errors';
import { assertCompleteXtreamRendererProbe } from './xtream-renderer-probe';
import {
    XTREAM_SCENARIO_DATABASE_REQUEST_COUNT,
    type XtreamScenarioTerminalEvidence,
    type XtreamScenarioTriggerEvidence,
} from './xtream-scenario-driver';
import {
    XTREAM_NOT_APPLICABLE,
    XTREAM_STARTUP_RETRY_REASON,
    type XtreamCatalogVerification as XtreamSummaryCatalogVerification,
    type XtreamIterationProcessIdentity,
    type XtreamRawIterationResult,
    type XtreamStartupRetryReason,
} from './xtream-summary-contract';

export interface XtreamIterationProcessEvidence {
    readonly electronPid: number;
    readonly freshProcessVerified: true;
    readonly launchId: string;
    readonly profileDirectorySha256: string;
    readonly startupAttemptCount: 1 | 2;
    readonly startupRetryReasons: readonly XtreamStartupRetryReason[];
}

export interface XtreamIterationAssemblyInput {
    readonly catalogVerification: XtreamCatalogVerification;
    readonly definition: XtreamIterationDefinition;
    readonly diagnosticArtifacts: XtreamDiagnosticArtifactEvidence | null;
    readonly mainCapture: XtreamMainCaptureResult;
    readonly process: XtreamIterationProcessEvidence;
    readonly rendererCapture: XtreamRendererCaptureMetrics;
    readonly terminal: XtreamScenarioTerminalEvidence;
    readonly trigger: XtreamScenarioTriggerEvidence;
}

export function assembleXtreamRawIteration(
    input: XtreamIterationAssemblyInput
): XtreamRawIterationResult {
    try {
        return assembleStrict(input);
    } catch {
        throw new Error('xtream-iteration-assembly-invalid');
    }
}

function assembleStrict(
    input: XtreamIterationAssemblyInput
): XtreamRawIterationResult {
    assertInputBoundary(input);
    const diagnostic = validateDiagnosticEvidence(input);
    assertXtreamMainEvidenceGates(input.mainCapture);
    assertCompleteXtreamRendererProbe(input.rendererCapture.probe);
    const phaseCapture = deriveXtreamPhaseCapture(
        input.definition.scenarioId,
        input.mainCapture,
        input.rendererCapture
    );
    const phases = attributeXtreamPhases(phaseCapture);
    const scenario = assembleXtreamScenarioEvidence({
        main: input.mainCapture,
        phaseCapture,
        renderer: input.rendererCapture,
        scenarioId: input.definition.scenarioId,
        terminal: input.terminal,
        trigger: input.trigger,
    });
    const context = {
        diagnostic,
        kind: input.definition.kind,
    };
    const raw: XtreamRawIterationResult = {
        ...input.definition,
        cancellation: scenario.cancellation,
        cancellationEvidence: scenario.cancellationEvidence,
        catalogVerification: copyCatalogVerification(input.catalogVerification),
        databaseWorker: createXtreamDatabaseWorkerMetrics(
            input.mainCapture,
            context
        ),
        main: createXtreamMainMetrics(input.mainCapture, context),
        phaseCapture,
        phases,
        playlistRefreshWorker: {
            instantiated: false,
            reason: XTREAM_NOT_APPLICABLE.PLAYLIST_REFRESH_WORKER,
        },
        processIdentity: createProcessIdentity(input),
        renderer: createXtreamRendererMetrics(
            input.mainCapture,
            input.rendererCapture,
            context,
            scenario.backgroundMetrics
        ),
        validity: {
            actionContractValid: true,
            catalogContractValid: true,
            databaseWorkerCount: input.mainCapture.databaseWorkerCount,
            dbPhaseContractValid: true,
            diagnosticArtifactsValid:
                input.definition.kind === XTREAM_ITERATION_KIND.DIAGNOSTIC
                    ? true
                    : null,
            lateDatabaseRequestCount:
                input.mainCapture.lateDatabaseRequestCount,
            playlistWorkerCount: input.mainCapture.playlistRefreshWorkerCount,
            rendererTargetCount: 1,
        },
    };
    assertXtreamIterationEvidenceBinding(raw);
    assertXtreamIterationResult(raw);
    return freezeDeep(raw);
}

function assertInputBoundary(input: XtreamIterationAssemblyInput): void {
    const scenarioId = input.definition.scenarioId;
    if (
        !Object.values(XTREAM_SCENARIO_ID).includes(scenarioId) ||
        input.mainCapture.requests.length !==
            XTREAM_SCENARIO_DATABASE_REQUEST_COUNT[scenarioId] ||
        !validXtreamRendererConsoleErrorEvidence(
            input.rendererCapture.consoleErrorCount,
            input.rendererCapture.consoleErrorBreakdown,
            scenarioId
        ) ||
        input.rendererCapture.pageErrorCount !== 0 ||
        input.rendererCapture.storeToPaintMs !==
            requireEpoch(input.rendererCapture.probe.uiPaintedEpochMs) -
                requireEpoch(input.rendererCapture.probe.storeTerminalEpochMs)
    ) {
        invalid();
    }
    const catalog = input.catalogVerification;
    if (
        catalog.databaseStateValid !== true ||
        catalog.fixtureIdentityValid !== true ||
        catalog.verifiedAfterCapture !== true ||
        catalog.providerCategoryCount !== 100 ||
        catalog.providerItemCount !== 100_000
    ) {
        invalid();
    }
}

function copyCatalogVerification(
    catalog: XtreamCatalogVerification
): XtreamSummaryCatalogVerification {
    return {
        databaseStateValid: catalog.databaseStateValid,
        fixtureIdentityValid: catalog.fixtureIdentityValid,
        providerCategoryCount: catalog.providerCategoryCount as 100,
        providerItemCount: catalog.providerItemCount as 100_000,
        verifiedAfterCapture: catalog.verifiedAfterCapture,
    };
}

function validateDiagnosticEvidence(
    input: XtreamIterationAssemblyInput
): XtreamDiagnosticArtifactEvidence | null {
    if (input.definition.kind !== XTREAM_ITERATION_KIND.DIAGNOSTIC) {
        if (
            input.diagnosticArtifacts !== null ||
            input.mainCapture.capture.cpuProfilePath !== null ||
            input.mainCapture.capture.heapSnapshotPath !== null ||
            input.rendererCapture.cpuProfilePath !== null ||
            input.rendererCapture.heapSnapshotPath !== null ||
            input.rendererCapture.tracePath !== null ||
            input.mainCapture.workers.some(
                ({ profilePath, snapshotPath }) =>
                    profilePath !== null || snapshotPath !== null
            )
        ) {
            invalid();
        }
        return null;
    }
    assertXtreamDiagnosticArtifactEvidence(input.diagnosticArtifacts);
    if (
        input.process.profileDirectorySha256 !==
        input.diagnosticArtifacts.directorySha256
    ) {
        invalid();
    }
    return input.diagnosticArtifacts;
}

function createProcessIdentity(
    input: XtreamIterationAssemblyInput
): XtreamIterationProcessIdentity {
    const process = input.process;
    if (
        process.freshProcessVerified !== true ||
        !Number.isSafeInteger(process.electronPid) ||
        process.electronPid <= 0 ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(process.launchId) ||
        !/^[a-f0-9]{64}$/.test(process.profileDirectorySha256) ||
        !validStartupEvidence(process)
    ) {
        invalid();
    }
    const captureGeneration = input.mainCapture.captureGeneration;
    if (!Number.isSafeInteger(captureGeneration) || captureGeneration <= 0) {
        invalid();
    }
    const identity = {
        captureGeneration,
        electronPid: process.electronPid,
        launchId: process.launchId,
        profileDirectorySha256: process.profileDirectorySha256,
        startupAttemptCount: process.startupAttemptCount,
        startupRetryReasons: process.startupRetryReasons,
        rendererTargetId: input.rendererCapture.targetId,
        browserWindowId:
            input.mainCapture.capture.rendererWindow.windowIdentity
                .browserWindowId,
        webContentsId:
            input.mainCapture.capture.rendererWindow.windowIdentity
                .webContentsId,
    };
    return {
        captureGeneration,
        electronPid: process.electronPid,
        freshProcess: true,
        generationIdentitySha256: createHash('sha256')
            .update(JSON.stringify(identity))
            .digest('hex'),
        launchId: process.launchId,
        profileDirectorySha256: process.profileDirectorySha256,
        startupAttemptCount: process.startupAttemptCount,
        startupRetryReasons: [...process.startupRetryReasons],
    };
}

function validStartupEvidence(
    process: XtreamIterationProcessEvidence
): boolean {
    return (
        (process.startupAttemptCount === 1 ||
            process.startupAttemptCount === 2) &&
        Array.isArray(process.startupRetryReasons) &&
        process.startupRetryReasons.length ===
            process.startupAttemptCount - 1 &&
        process.startupRetryReasons.every((reason) =>
            Object.values(XTREAM_STARTUP_RETRY_REASON).includes(reason)
        )
    );
}

function requireEpoch(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        invalid();
    return value;
}

function invalid(): never {
    throw new Error('invalid Xtream iteration assembly input');
}
