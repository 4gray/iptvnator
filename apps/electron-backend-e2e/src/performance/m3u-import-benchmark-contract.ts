import {
    PERFORMANCE_ITERATION_KIND,
    type PerformanceIterationKind,
} from './m3u-refresh-cancellation-contract';
import { SYNTHETIC_M3U_RESOURCE_PATH } from './synthetic-m3u-server';
import type { SyntheticM3uChannelCount } from './synthetic-m3u';

export const M3U_IMPORT_SCENARIO_ID = {
    IMPORT_10K: 'm3u-import-10k',
    IMPORT_50K: 'm3u-import-50k',
    IMPORT_100K: 'm3u-import-100k',
} as const;

export type M3uImportScenarioId =
    (typeof M3U_IMPORT_SCENARIO_ID)[keyof typeof M3U_IMPORT_SCENARIO_ID];

export interface M3uImportScenario {
    readonly channelCount: SyntheticM3uChannelCount;
    readonly id: M3uImportScenarioId;
}

export interface M3uImportIterationDefinition {
    readonly channelCount: SyntheticM3uChannelCount;
    readonly kind: PerformanceIterationKind;
    readonly runId: string;
    readonly scenarioId: M3uImportScenarioId;
}

const SCENARIOS: readonly M3uImportScenario[] = Object.freeze([
    Object.freeze({
        channelCount: 10_000,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_10K,
    }),
    Object.freeze({
        channelCount: 50_000,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_50K,
    }),
    Object.freeze({
        channelCount: 100_000,
        id: M3U_IMPORT_SCENARIO_ID.IMPORT_100K,
    }),
]);

export function listM3uImportScenarios(): readonly M3uImportScenario[] {
    return SCENARIOS;
}

export function createM3uImportIterationDefinitions(
    smoke: boolean
): readonly M3uImportIterationDefinition[] {
    const measuredRuns = smoke ? 1 : 5;
    const definitions: M3uImportIterationDefinition[] = [];

    for (const scenario of SCENARIOS) {
        definitions.push(
            iteration(scenario, PERFORMANCE_ITERATION_KIND.WARMUP, 'warmup-01')
        );
        for (let index = 1; index <= measuredRuns; index += 1) {
            definitions.push(
                iteration(
                    scenario,
                    PERFORMANCE_ITERATION_KIND.MEASURED,
                    `run-${String(index).padStart(2, '0')}`
                )
            );
        }
        definitions.push(
            iteration(
                scenario,
                PERFORMANCE_ITERATION_KIND.DIAGNOSTIC,
                'diagnostic'
            )
        );
    }

    return Object.freeze(definitions);
}

export function assertSyntheticM3uImportUrl(value: string): void {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw invalidSyntheticUrl();
    }

    if (
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        url.port.length === 0 ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.pathname !== SYNTHETIC_M3U_RESOURCE_PATH ||
        url.search.length > 0 ||
        url.hash.length > 0
    ) {
        throw invalidSyntheticUrl();
    }
}

function iteration(
    scenario: M3uImportScenario,
    kind: PerformanceIterationKind,
    runId: string
): M3uImportIterationDefinition {
    return Object.freeze({
        channelCount: scenario.channelCount,
        kind,
        runId,
        scenarioId: scenario.id,
    });
}

function invalidSyntheticUrl(): Error {
    return new Error(
        'M3U performance fixture must use the exact synthetic HTTP loopback URL'
    );
}
