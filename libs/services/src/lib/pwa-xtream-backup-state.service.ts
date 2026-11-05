import { inject, Injectable } from '@angular/core';
import { PwaXtreamBackupStorage } from './pwa-xtream-backup-storage';
import { USER_DATA_STORAGE } from './user-data-storage';

/** Angular owner of the shared browser import/retry persistence contract. */
@Injectable({ providedIn: 'root' })
export class PwaXtreamBackupStateService extends PwaXtreamBackupStorage {
    constructor() {
        super(inject(USER_DATA_STORAGE));
    }
}
