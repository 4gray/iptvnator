export function deriveXtreamAcquisitionDurationMs(
    networkTotalDurationMs: number,
    jsonTransformDurationMs: number
): number {
    if (
        !Number.isFinite(networkTotalDurationMs) ||
        networkTotalDurationMs < 0 ||
        !Number.isFinite(jsonTransformDurationMs) ||
        jsonTransformDurationMs < 0 ||
        jsonTransformDurationMs > networkTotalDurationMs
    ) {
        throw new Error('xtream-acquisition-duration-invalid');
    }
    return networkTotalDurationMs - jsonTransformDurationMs;
}
