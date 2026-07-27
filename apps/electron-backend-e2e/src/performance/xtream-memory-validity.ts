export function assertXtreamWorkerHeapWithinMainRss(
    worker: unknown,
    main: unknown
): void {
    const workerMetrics = worker as Record<string, unknown>;
    const mainMetrics = main as Record<string, unknown>;
    if (
        (workerMetrics['peakHeapUsedBytes'] as number) >
        (mainMetrics['peakRssBytes'] as number)
    ) {
        throw new Error('database-worker heap exceeds Electron main RSS');
    }
}
