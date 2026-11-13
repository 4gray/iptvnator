import { InjectionToken } from '@angular/core';
import type { MultiviewTileSource } from './multiview-session.model';

/** Where the source picker was opened from (spec 9.5). */
export type MultiviewPickRequest =
    | { readonly context: 'add' }
    | { readonly context: 'replace'; readonly tileId: string };

/**
 * The multiview source picker (spec 9.5). Provided by the workspace feature
 * that implements it; without a provider there is no picker and the dock
 * shows no multiview button.
 */
export interface MultiviewSourcePicker {
    /** Resolves the chosen source, or null when the viewer closed it. */
    pick(request: MultiviewPickRequest): Promise<MultiviewTileSource | null>;
}

export const MULTIVIEW_SOURCE_PICKER =
    new InjectionToken<MultiviewSourcePicker>('MULTIVIEW_SOURCE_PICKER');

/** What a playlist's provider allows at once, as it reports it (spec 12). */
export interface MultiviewConnectionBudget {
    readonly playlistName: string;
    readonly maxConnections: number;
    readonly activeConnections: number;
}

/**
 * Reads a playlist's connection budget. Only providers that report one
 * (Xtream `user_info`) answer; others resolve null ("limit ?").
 */
export interface MultiviewConnectionBudgetSource {
    budgetFor(playlistId: string): Promise<MultiviewConnectionBudget | null>;
}

export const MULTIVIEW_CONNECTION_BUDGET =
    new InjectionToken<MultiviewConnectionBudgetSource>(
        'MULTIVIEW_CONNECTION_BUDGET'
    );

/** Free connections; never negative. */
export function freeConnections(budget: MultiviewConnectionBudget): number {
    return Math.max(0, budget.maxConnections - budget.activeConnections);
}
