import { untracked } from '@angular/core';
import type { SourceActivityService } from '@iptvnator/services';

/** Cold route coordination keeps waiting logic outside the startup path. */
export function waitForSourceIdle(
    activity: SourceActivityService,
    id: string,
    ownHolds = 0
): Promise<void> {
    return new Promise((resolve) => {
        const check = () => {
            if (!untracked(() => activity.isBusy(id, ownHolds))) {
                unsubscribe();
                resolve();
            }
        };
        const unsubscribe = activity.onRelease(check);
        check();
    });
}
