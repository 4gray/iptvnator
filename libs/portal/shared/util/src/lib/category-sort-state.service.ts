import { Injectable, signal } from '@angular/core';
import {
    PortalCategorySortMode,
    persistPortalCategorySortMode,
    restorePortalCategorySortMode,
} from './category-sort';

/**
 * The portal categories sort preference, shared by every rendered category
 * list. The workspace context panel is stamped twice while the categories
 * rail is folded (the in-flow rail stays mounted, the popover shows a second
 * copy), and a per-instance signal seeded from storage would let a sort
 * picked in the popover revert the moment the rail comes back.
 */
@Injectable({ providedIn: 'root' })
export class PortalCategorySortStateService {
    private readonly _mode = signal<PortalCategorySortMode>(
        restorePortalCategorySortMode()
    );
    readonly mode = this._mode.asReadonly();

    setMode(mode: PortalCategorySortMode): void {
        this._mode.set(mode);
        persistPortalCategorySortMode(mode);
    }
}
