export interface XtreamMainLifecyclePhase {
    readonly endEpochMs: number | null;
    readonly phase: string;
    readonly startEpochMs: number;
}

export interface XtreamMainLifecycleInput {
    readonly method: string;
    readonly outcome: 'error' | 'success' | null;
    readonly phases: readonly XtreamMainLifecyclePhase[];
}

export interface XtreamMainLifecycleValidator {
    validate(input: XtreamMainLifecycleInput): string | null;
}

export function createXtreamMainLifecycleValidator(): XtreamMainLifecycleValidator {
    const helpers = {
        closedPhase(
            phases: readonly XtreamMainLifecyclePhase[],
            phase: string
        ): XtreamMainLifecyclePhase | null {
            const matches = phases.filter(
                (candidate) => candidate.phase === phase
            );
            const match = matches[0];
            return matches.length === 1 && match && match.endEpochMs !== null
                ? match
                : null;
        },
        isEpoch(value: unknown): value is number {
            return (
                typeof value === 'number' && Number.isFinite(value) && value > 0
            );
        },
    };
    return {
        validate(input): string | null {
            const phaseNames = input.phases.map(({ phase }) => phase);
            if (
                new Set(phaseNames).size !== phaseNames.length ||
                input.phases.some(
                    ({ endEpochMs, startEpochMs }) =>
                        !helpers.isEpoch(startEpochMs) ||
                        (endEpochMs !== null &&
                            (!helpers.isEpoch(endEpochMs) ||
                                endEpochMs < startEpochMs))
                )
            ) {
                return 'main-phase-inventory-incomplete';
            }
            if (input.method === 'xtreamCancelSession') {
                return helpers.closedPhase(
                    input.phases,
                    'xtream.cancel-session'
                ) &&
                    phaseNames.every(
                        (phase) => phase === 'xtream.cancel-session'
                    )
                    ? null
                    : 'main-phase-inventory-incomplete';
            }
            if (
                input.method !== 'xtreamRequest' ||
                (input.outcome !== 'success' && input.outcome !== 'error')
            ) {
                return 'main-phase-inventory-incomplete';
            }

            const network = helpers.closedPhase(
                input.phases,
                'xtream.network.total'
            );
            const json = helpers.closedPhase(
                input.phases,
                'xtream.json.transform'
            );
            const response = helpers.closedPhase(
                input.phases,
                'xtream.response.ready'
            );
            if (
                !network ||
                phaseNames.some(
                    (phase) =>
                        phase !== 'xtream.network.total' &&
                        phase !== 'xtream.json.transform' &&
                        phase !== 'xtream.response.ready'
                ) ||
                (phaseNames.includes('xtream.json.transform') && !json) ||
                (input.outcome === 'success' && (!json || !response))
            ) {
                return 'main-phase-inventory-incomplete';
            }
            if (
                (json &&
                    (json.startEpochMs < network.startEpochMs ||
                        Number(json.endEpochMs) >
                            Number(network.endEpochMs))) ||
                (input.outcome === 'success' &&
                    response !== null &&
                    response.startEpochMs < Number(network.endEpochMs)) ||
                (input.outcome === 'error' &&
                    phaseNames.includes('xtream.response.ready'))
            ) {
                return 'main-phase-topology-invalid';
            }
            return null;
        },
    };
}
