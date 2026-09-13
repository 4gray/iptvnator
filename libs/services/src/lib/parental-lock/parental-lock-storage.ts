import { inject, Injectable } from '@angular/core';
import {
    normalizeParentalLockStore,
    PARENTAL_LOCK_PIN_KEY,
    PARENTAL_LOCK_STORE_KEY,
    ParentalLockStore,
} from '@iptvnator/shared/interfaces';
import { DatabaseService } from '../database-electron.service';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';

/**
 * Persistence for the parental lock: the hashed PIN and the lock store.
 *
 * Both live OUTSIDE `Settings` on purpose. Settings are logged (redacted,
 * but still), exported in backups and mirrored to the main process; a PIN
 * hash belongs in none of those places. Electron keeps them in the SQLite
 * `app_state` table, the PWA in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ParentalLockStorageService {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly databaseService = inject(DatabaseService);

    private get usesAppState(): boolean {
        return this.runtime.supportsAppStateStorage;
    }

    async readPinHash(): Promise<string | null> {
        const value = await this.read(PARENTAL_LOCK_PIN_KEY);
        return value && value.trim() !== '' ? value : null;
    }

    async writePinHash(hash: string): Promise<boolean> {
        return this.write(PARENTAL_LOCK_PIN_KEY, hash);
    }

    async readLocks(): Promise<ParentalLockStore> {
        const raw = await this.read(PARENTAL_LOCK_STORE_KEY);
        if (!raw) {
            return {};
        }
        try {
            return normalizeParentalLockStore(JSON.parse(raw));
        } catch {
            return {};
        }
    }

    async writeLocks(store: ParentalLockStore): Promise<boolean> {
        return this.write(
            PARENTAL_LOCK_STORE_KEY,
            JSON.stringify(normalizeParentalLockStore(store))
        );
    }

    private async read(key: string): Promise<string | null> {
        if (this.usesAppState) {
            return this.databaseService.getAppState(key);
        }
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    private async write(key: string, value: string): Promise<boolean> {
        if (this.usesAppState) {
            return this.databaseService.setAppState(key, value);
        }
        try {
            localStorage.setItem(key, value);
            return localStorage.getItem(key) === value;
        } catch {
            return false;
        }
    }
}
