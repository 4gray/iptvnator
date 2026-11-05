import type { UserDataStorage } from '@iptvnator/services';
import { PwaXtreamBackupStorage } from '@iptvnator/services/pwa-xtream-backup-storage';
import type { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';

/** Load backup persistence only for a restore, sharing the initial import contract. */
export function restorePwaXtreamUserData(
    storage: UserDataStorage,
    playlistId: string,
    state: XtreamPendingRestoreState
): Promise<void> {
    return new PwaXtreamBackupStorage(storage).restore(playlistId, state);
}
