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
