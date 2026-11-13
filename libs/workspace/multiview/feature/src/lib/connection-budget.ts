import {
    freeConnections,
    type MultiviewConnectionBudget,
} from '@iptvnator/playback/multiview/data-access';

/** The badge beside a playlist in the picker (spec 9.5, 12). */
export type ConnectionBudgetBadge =
    | { readonly kind: 'free'; readonly free: number }
    | { readonly kind: 'full' }
    | { readonly kind: 'unknown' };

function count(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Xtream `user_info` → budget. A panel without a positive
 * `max_connections` states no limit we can show, so it reads "limit ?".
 */
export function connectionBudgetFromUserInfo(
    info:
        | { readonly max_connections?: unknown; readonly active_cons?: unknown }
        | null
        | undefined,
    playlistName: string
): MultiviewConnectionBudget | null {
    const max = count(info?.max_connections);
    if (max === null || max <= 0) return null;
    return {
        playlistName,
        maxConnections: max,
        activeConnections: Math.max(0, count(info?.active_cons) ?? 0),
    };
}

export function connectionBudgetBadge(
    budget: MultiviewConnectionBudget | null
): ConnectionBudgetBadge {
    if (!budget) return { kind: 'unknown' };
    const free = freeConnections(budget);
    return free === 0 ? { kind: 'full' } : { kind: 'free', free };
}

/** Segments of the footer meter: used ones first, then the free ones. */
export function connectionMeter(
    budget: MultiviewConnectionBudget
): readonly ('used' | 'free')[] {
    const used = Math.min(budget.activeConnections, budget.maxConnections);
    return Array.from({ length: budget.maxConnections }, (_, index) =>
        index < used ? 'used' : 'free'
    );
}
