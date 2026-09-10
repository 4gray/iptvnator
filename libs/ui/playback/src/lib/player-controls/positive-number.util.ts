/**
 * The one positive-finite guard the controls' numeric readers share.
 *
 * Engines report "unknown" in every dialect there is — `undefined`, `null`,
 * `0`, `-1`, `NaN` — and every reader needs the same answer: a usable number,
 * or null. Keeping one implementation is what stops those dialects from being
 * re-interpreted slightly differently per engine.
 */
export function positiveOrNull(
    value: number | null | undefined
): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;
}
