export interface WorkerTerminationGenerationInput {
    readonly capturedGeneration: number | null;
    readonly currentGeneration: number;
    readonly recordGeneration: number | null;
}

export interface WorkerTerminationGenerationApi {
    isCurrent(input: WorkerTerminationGenerationInput): boolean;
}

export function createWorkerTerminationGenerationApi(): WorkerTerminationGenerationApi {
    const isCaptureGeneration = (value: number | null): value is number =>
        Number.isSafeInteger(value) && Number(value) > 0;

    return Object.freeze({
        isCurrent(input: WorkerTerminationGenerationInput): boolean {
            return (
                isCaptureGeneration(input.capturedGeneration) &&
                input.capturedGeneration === input.currentGeneration &&
                input.capturedGeneration === input.recordGeneration
            );
        },
    });
}
