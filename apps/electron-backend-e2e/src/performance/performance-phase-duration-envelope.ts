/**
 * Phase duration and epoch endpoints are read from separate clocks in separate
 * calls. The enclosing request/operation window is the causal upper bound.
 */
export function fitsPerformanceDurationEnvelope(
    durationMs: number,
    envelopeStartEpochMs: number,
    envelopeEndEpochMs: number
): boolean {
    return (
        Number.isFinite(durationMs) &&
        durationMs >= 0 &&
        Number.isFinite(envelopeStartEpochMs) &&
        Number.isFinite(envelopeEndEpochMs) &&
        envelopeEndEpochMs >= envelopeStartEpochMs &&
        durationMs <= envelopeEndEpochMs - envelopeStartEpochMs
    );
}
