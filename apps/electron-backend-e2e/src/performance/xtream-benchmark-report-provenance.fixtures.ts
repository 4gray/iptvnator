import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    createXtreamIterationDefinitions,
    XTREAM_ITERATION_KIND,
    XTREAM_SCENARIO_ID,
    type XtreamIterationDefinition,
} from './xtream-benchmark-contract';
import {
    validateXtreamDiagnosticArtifacts,
    type XtreamDiagnosticArtifactEvidence,
    type XtreamDiagnosticCapture,
} from './xtream-diagnostic-artifacts';
import { CPU_PROFILE } from './initial-import-diagnostic-test-fixtures';
import {
    iteration,
    persist,
    withWorkerRequestOverlap,
} from './xtream-benchmark-report.fixtures';
import type { XtreamValidatedIterationResult } from './xtream-summary-contract';

const HEAP_SNAPSHOT = {
    edges: [0, 0, 0],
    nodes: [0, 0, 1, 0, 1, 0],
    snapshot: {
        meta: {
            edge_fields: ['type', 'name_or_index', 'to_node'],
            edge_types: [['context'], 'string_or_number', 'node'],
            node_fields: [
                'type',
                'name',
                'id',
                'self_size',
                'edge_count',
                'detachedness',
            ],
            node_types: [
                ['hidden'],
                'string',
                'number',
                'number',
                'number',
                'number',
            ],
        },
    },
    strings: ['', 'root'],
};
const RENDERER_TRACE = {
    traceEvents: [{ name: 'xtream-diagnostic', ph: 'X', ts: 1 }],
};
const directories: string[] = [];

export interface XtreamReportFixture {
    readonly diagnosticEvidence: ReadonlyMap<
        XtreamValidatedIterationResult,
        XtreamDiagnosticArtifactEvidence
    >;
    readonly iterations: readonly XtreamValidatedIterationResult[];
}

export async function formalReportFixture(): Promise<XtreamReportFixture> {
    return reportFixture(createXtreamIterationDefinitions(false), 10, true);
}

export async function smokeReportFixture(): Promise<XtreamReportFixture> {
    return reportFixture(createXtreamIterationDefinitions(true), 100, false);
}

export async function clearXtreamProvenanceFixtureDirectories(): Promise<void> {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
}

async function reportFixture(
    definitions: readonly XtreamIterationDefinition[],
    identityOffset: number,
    mixedInitialOverlap: boolean
): Promise<XtreamReportFixture> {
    const entries = await Promise.all(
        definitions.map(async (definition, index) => {
            const identity = index + 1;
            let raw = iteration(definition, identity);
            let evidence: XtreamDiagnosticArtifactEvidence | null = null;
            if (definition.kind === XTREAM_ITERATION_KIND.DIAGNOSTIC) {
                evidence = await diagnosticEvidence(identity + identityOffset);
                raw = {
                    ...raw,
                    processIdentity: {
                        ...raw.processIdentity,
                        profileDirectorySha256: evidence.directorySha256,
                    },
                };
            }
            if (
                mixedInitialOverlap &&
                definition.scenarioId ===
                    XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE &&
                ['run-02', 'run-04'].includes(definition.runId)
            ) {
                raw = withWorkerRequestOverlap(raw, 2);
            }
            return {
                evidence,
                iteration: await persist(raw, identity + identityOffset),
            };
        })
    );
    return {
        diagnosticEvidence: new Map(
            entries.flatMap(({ evidence, iteration: result }) =>
                evidence ? [[result, evidence] as const] : []
            )
        ),
        iterations: entries.map(({ iteration: result }) => result),
    };
}

async function diagnosticEvidence(
    identity: number
): Promise<XtreamDiagnosticArtifactEvidence> {
    const directory = await mkdtemp(
        join(tmpdir(), `iptvnator-xtream-report-diagnostic-${identity}-`)
    );
    directories.push(directory);
    await writeArtifacts(directory);
    return validateXtreamDiagnosticArtifacts(capture(directory), directory);
}

function capture(directory: string): XtreamDiagnosticCapture {
    return {
        main: {
            cpuProfilePath: join(directory, 'main.cpuprofile'),
            heapSnapshotPath: join(directory, 'main.heapsnapshot'),
            workers: [
                {
                    kind: 'database.worker',
                    ordinal: 1,
                    profilePath: join(
                        directory,
                        'database.worker-1.cpuprofile'
                    ),
                    snapshotPath: join(
                        directory,
                        'database.worker-1.heapsnapshot'
                    ),
                },
            ],
        },
        renderer: {
            cpuProfilePath: join(directory, 'renderer.cpuprofile'),
            heapSnapshotPath: join(directory, 'renderer.heapsnapshot'),
            tracePath: join(directory, 'renderer.trace.json'),
        },
    };
}

async function writeArtifacts(directory: string): Promise<void> {
    const artifacts = [
        ['main.cpuprofile', CPU_PROFILE],
        ['renderer.cpuprofile', CPU_PROFILE],
        ['database.worker-1.cpuprofile', CPU_PROFILE],
        ['main.heapsnapshot', HEAP_SNAPSHOT],
        ['renderer.heapsnapshot', HEAP_SNAPSHOT],
        ['database.worker-1.heapsnapshot', HEAP_SNAPSHOT],
        ['renderer.trace.json', RENDERER_TRACE],
    ] as const;
    await Promise.all(
        artifacts.map(([filename, value]) =>
            writeFile(join(directory, filename), JSON.stringify(value))
        )
    );
}
