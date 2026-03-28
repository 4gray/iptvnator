export interface OperationProgressUpdate {
    phase: string;
    current?: number;
    total?: number;
    increment?: number;
}

export interface OperationControl {
    checkpoint?: () => void | Promise<void>;
    onProgress?: (
        progress: OperationProgressUpdate
    ) => void | Promise<void>;
}

export async function checkpointOperation(
    control?: OperationControl
): Promise<void> {
    await control?.checkpoint?.();
}

export async function reportOperationProgress(
    control: OperationControl | undefined,
    progress: OperationProgressUpdate
): Promise<void> {
    await control?.onProgress?.(progress);
    await checkpointOperation(control);
}

export function chunkValues<T>(
    values: T[],
    chunkSize: number
): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < values.length; index += chunkSize) {
        chunks.push(values.slice(index, index + chunkSize));
    }

    return chunks;
}
