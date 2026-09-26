import { inject, Injectable } from '@angular/core';
import {
    isWellFormedParentalLockStore,
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

    /**
     * The stored PIN hash (`hash: null` when none was set up), or `null`
     * when the read itself failed — the service then retries before every
     * PIN-protected operation instead of treating the PIN as absent.
     */
    async readPinHash(): Promise<{ hash: string | null } | null> {
        const result = await this.read(PARENTAL_LOCK_PIN_KEY);
        if (result === null) {
            return null;
        }
        const value = result.value;
        return { hash: value && value.trim() !== '' ? value : null };
    }

    async writePinHash(hash: string): Promise<boolean> {
        return this.write(PARENTAL_LOCK_PIN_KEY, hash);
    }

    /**
     * The lock store, or `null` when it could not be READ — distinct from an
     * absent store, which is `{}`. A failed read must not look like "nothing
     * is locked": the service withholds everything until it can read again.
     * A stored payload that does not parse, or is not an object, counts as
     * a failed read too: corruption must not become an empty store.
     */
    async readLocks(): Promise<ParentalLockStore | null> {
        const result = await this.read(PARENTAL_LOCK_STORE_KEY);
        if (result === null) {
            return null;
        }
        if (!result.value) {
            return {};
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(result.value);
        } catch {
            return null;
        }
        if (!isWellFormedParentalLockStore(parsed)) {
            return null;
        }
        return normalizeParentalLockStore(parsed);
    }

    async writeLocks(store: ParentalLockStore): Promise<boolean> {
        return this.write(
            PARENTAL_LOCK_STORE_KEY,
            JSON.stringify(normalizeParentalLockStore(store))
        );
    }

    /** `null` when the read itself failed; an absent key is `{ value: null }`. */
    private async read(key: string): Promise<{ value: string | null } | null> {
        if (this.usesAppState) {
            return this.databaseService.readAppState(key);
        }
        try {
            return { value: localStorage.getItem(key) };
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
