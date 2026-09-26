import type { ElectronApplication } from '@playwright/test';

/**
 * Test-side client for the main-process gate in
 * `../performance/journey-renderer-gate.cjs`.
 */
export const JOURNEY_RENDERER_GATE_KEY = '__iptvnatorJourneyGate';

export interface JourneyRendererGateState {
    readonly blankLoadedEpochMs: number | null;
    readonly errors: readonly string[];
    readonly gatedEpochMs: number | null;
    readonly gatedMethod: string | null;
    readonly passThroughLoads: number;
    readonly releasedEpochMs: number | null;
    readonly timedOut: boolean;
}

export async function readJourneyRendererGate(
    electronApp: ElectronApplication,
    gateKey: string,
    action: 'read' | 'release'
): Promise<JourneyRendererGateState> {
    const state = await electronApp.evaluate(
        (_electron, input) => {
            const gate = (globalThis as unknown as Record<string, unknown>)[
                input.gateKey
            ] as { release(): unknown; state: unknown } | undefined;
            if (!gate) {
                return null;
            }
            const result =
                input.action === 'release' ? gate.release() : gate.state;
            return JSON.parse(JSON.stringify(result)) as unknown;
        },
        { action, gateKey }
    );
    if (state === null) {
        throw new Error('journey-renderer-gate-not-installed');
    }
    return state as JourneyRendererGateState;
}

/**
 * The gate proves the ordering the counters rely on: the real document was
 * loaded once, only after the test released it, and the renderer probe ran
 * after the release (so it was registered before that document existed).
 */
export function assertJourneyRendererGate(
    gate: JourneyRendererGateState,
    rendererProbeInstalledEpochMs: number
): JourneyRendererGateState {
    if (gate.timedOut) {
        throw new Error('journey-renderer-gate-timed-out');
    }
    if (gate.errors.length > 0) {
        throw new Error(
            `journey-renderer-gate-errors: ${gate.errors.join(', ')}`
        );
    }
    if (
        gate.gatedEpochMs === null ||
        gate.blankLoadedEpochMs === null ||
        gate.releasedEpochMs === null
    ) {
        throw new Error('journey-renderer-gate-incomplete');
    }
    if (gate.passThroughLoads !== 0) {
        throw new Error(
            `journey-renderer-gate-extra-loads-${gate.passThroughLoads}`
        );
    }
    if (rendererProbeInstalledEpochMs < gate.releasedEpochMs) {
        throw new Error('journey-renderer-gate-probe-before-release');
    }
    return gate;
}
