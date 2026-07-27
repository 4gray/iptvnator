import type { DatabaseWorkerPostGcProbeUnavailableReason } from './database-worker-post-gc-probe';
import type { DatabaseWorkerPostGcUnavailableReason } from './database-worker-post-gc-selection';

export type DatabaseWorkerPostGcAncillaryFailureStage =
    'heap-snapshot' | 'post-gc-probe' | 'profile-stop' | 'profile-write';

export type DatabaseWorkerPostGcFinalizationOutcome =
    | {
          readonly postGcHeapUsedBytes: number;
          readonly unavailableReason: null;
      }
    | {
          readonly postGcHeapUsedBytes: null;
          readonly unavailableReason:
              | DatabaseWorkerPostGcProbeUnavailableReason
              | DatabaseWorkerPostGcUnavailableReason;
      };

export interface DatabaseWorkerPostGcFinalizationInput {
    readonly finalizationKey: object;
    readonly joinFinalSample: () => Promise<void>;
    readonly probePostGc: () => Promise<DatabaseWorkerPostGcFinalizationOutcome>;
    readonly reportAncillaryFailure: (
        stage: DatabaseWorkerPostGcAncillaryFailureStage,
        error: unknown
    ) => void;
    readonly stopProfile: () => Promise<void>;
    readonly stopSampling: () => void;
    readonly takeHeapSnapshot?: () => Promise<void>;
}

export interface DatabaseWorkerPostGcFinalizationApi {
    finalize(
        input: DatabaseWorkerPostGcFinalizationInput
    ): Promise<DatabaseWorkerPostGcFinalizationOutcome>;
}

export function createDatabaseWorkerPostGcFinalizationApi(): DatabaseWorkerPostGcFinalizationApi {
    const finalizations = new WeakMap<
        object,
        Promise<DatabaseWorkerPostGcFinalizationOutcome>
    >();

    const helpers = {
        async run(
            input: DatabaseWorkerPostGcFinalizationInput
        ): Promise<DatabaseWorkerPostGcFinalizationOutcome> {
            input.stopSampling();
            await input.joinFinalSample();
            try {
                await input.stopProfile();
            } catch (error: unknown) {
                input.reportAncillaryFailure('profile-stop', error);
            }

            let outcome: DatabaseWorkerPostGcFinalizationOutcome;
            try {
                outcome = await input.probePostGc();
            } catch (error: unknown) {
                input.reportAncillaryFailure('post-gc-probe', error);
                outcome = {
                    postGcHeapUsedBytes: null,
                    unavailableReason: 'capture-failed',
                };
            }
            if (input.takeHeapSnapshot) {
                try {
                    await input.takeHeapSnapshot();
                } catch (error: unknown) {
                    input.reportAncillaryFailure('heap-snapshot', error);
                }
            }
            return outcome;
        },

        finalize(
            input: DatabaseWorkerPostGcFinalizationInput
        ): Promise<DatabaseWorkerPostGcFinalizationOutcome> {
            const existing = finalizations.get(input.finalizationKey);
            if (existing) {
                return existing;
            }
            const finalization = helpers.run(input);
            finalizations.set(input.finalizationKey, finalization);
            return finalization;
        },
    };

    return Object.freeze({ finalize: helpers.finalize });
}
