import {
    computed,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import {
    hashParentalLockPin,
    normalizeParentalLockRelockMinutes,
    ParentalLockPlaylistLocks,
    ParentalLockStalkerCategoryType,
    ParentalLockXtreamCategoryType,
    verifyParentalLockPin,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '../settings-store.service';
import { ParentalLockIdleTimer } from './parental-lock-idle-timer';
import { ParentalLockLockStore } from './parental-lock-lock-store.service';
import {
    PARENTAL_LOCK_PROMPT,
    ParentalLockPromptRequest,
} from './parental-lock-prompt.token';
import {
    mirrorParentalLockEnabledSetting,
    syncParentalLockStateToMainProcess,
} from './parental-lock-bridge';
import { ParentalLockStorageService } from './parental-lock-storage';

/**
 * Parental lock: hides locked categories everywhere until the PIN is
 * entered.
 *
 * Source of truth for WHICH categories are locked is the lock store held
 * here (persisted through `ParentalLockStorageService`); the Electron
 * `categories.locked` column is only a query index derived from it, so the
 * SQLite worker can filter reads server-side.
 *
 * `active` is the enforcement flag: feature enabled and no PIN entered.
 * Everything that renders catalog content asks this service — the Xtream
 * data sources, the Stalker store, the M3U channel list, the workspace
 * rails — and re-queries when `version` changes. The unlock lives in memory
 * only: a restart always locks again, and so does the idle timer.
 */
@Injectable({ providedIn: 'root' })
export class ParentalLockService {
    private readonly settingsStore = inject(SettingsStore);
    private readonly storage = inject(ParentalLockStorageService);
    private readonly locks = inject(ParentalLockLockStore);
    private readonly prompt = inject(PARENTAL_LOCK_PROMPT, { optional: true });

    private readonly unlockedState = signal(false);
    private readonly pinHash = signal<string | null>(null);
    private readonly versionState = signal(0);
    // The main process starts LOCKED whenever the feature is on (mirrored
    // setting). Reporting our state before settings have loaded would send a
    // spurious "unlocked" and open a window of unfiltered reads.
    private readonly settingsReady = signal(false);
    private readonly busyProbes = new Set<() => boolean>();
    private readonly idleTimer = new ParentalLockIdleTimer({
        onExpire: () => this.lock(),
        isBusy: () => [...this.busyProbes].some((probe) => probe()),
    });
    private initialization: Promise<void> | null = null;
    private pendingUnlock: Promise<boolean> | null = null;

    /**
     * The persisted feature switch could not be read (IndexedDB failure):
     * `SettingsStore` then serves defaults, which would read as "off".
     */
    private readonly switchUnknown = computed(
        () => this.settingsStore.storageFailure?.() === 'load'
    );
    /**
     * The feature switch from settings. While the switch is unknown a stored
     * PIN stands in for it: the PIN exists only once a parent set the lock
     * up, so failing toward "locked" costs one PIN entry, whereas failing
     * toward "off" would expose every locked category precisely during a
     * storage failure.
     */
    readonly enabled = computed(() =>
        this.switchUnknown()
            ? this.pinHash() !== null
            : this.settingsStore.parentalLockEnabled?.() === true
    );
    /** Feature on and the PIN has been entered this session. */
    readonly unlocked = computed(() => this.enabled() && this.unlockedState());
    /** Locked categories must currently be withheld. */
    readonly active = computed(() => this.enabled() && !this.unlockedState());
    /** A PIN exists; enabling is only possible once this is true. */
    readonly hasPin = computed(() => this.pinHash() !== null);
    /**
     * Locked, and the lock store could not be read: which categories are
     * locked is unknown, so EVERY category is withheld — the renderer-side
     * filters treat every id as locked — until the PIN is entered or the
     * store reads again. Failing toward "nothing is locked" would expose the
     * protected content precisely during a storage failure.
     */
    readonly withholdsEverything = computed(
        () => this.active() && !this.locks.readable()
    );
    /** Bumps whenever `active` or the lock store changes; consumers re-query. */
    readonly version = computed(
        () => this.versionState() + this.locks.revision()
    );
    readonly relockMinutes = computed(() =>
        normalizeParentalLockRelockMinutes(
            this.settingsStore.parentalLockRelockMinutes?.()
        )
    );

    constructor() {
        effect(() => {
            const active = this.active();
            if (!this.settingsReady()) {
                return;
            }
            untracked(() => {
                this.versionState.update((value) => value + 1);
                // Unknown switch and no PIN to stand in for it: the main
                // process keeps its mirrored (locked) default rather than
                // being told "unlocked" on the strength of default settings.
                if (!this.switchUnknown() || this.hasPin()) {
                    syncParentalLockStateToMainProcess(active);
                }
            });
        });
        // The idle timer follows the UNLOCKED transition, not `active`:
        // enabling the feature from an unlocked session (setupPin) never
        // changes `active`, yet that session must still lock itself later.
        effect(() => {
            const unlocked = this.unlocked();
            const minutes = this.relockMinutes();
            untracked(() => {
                if (unlocked) {
                    this.idleTimer.arm(minutes);
                } else {
                    this.idleTimer.disarm();
                }
            });
        });
    }

    /** Loads the persisted PIN hash and lock store once. */
    initialize(): Promise<void> {
        if (!this.initialization) {
            this.initialization = (async () => {
                const [pinHash] = await Promise.all([
                    this.storage.readPinHash(),
                    this.locks.load(),
                    this.settingsStore.loadSettings(),
                ]);
                this.pinHash.set(pinHash);
                this.versionState.update((value) => value + 1);
                this.settingsReady.set(true);
            })().catch((error) => {
                console.error('Failed to load the parental lock state.', error);
                this.settingsReady.set(true);
            });
        }
        return this.initialization;
    }

    /**
     * Something that should keep the app unlocked while true, e.g. a playing
     * video. Returns the unregister function.
     */
    registerBusyProbe(probe: () => boolean): () => void {
        this.busyProbes.add(probe);
        return () => this.busyProbes.delete(probe);
    }

    /**
     * Asks for the PIN when the lock is active. Resolves true when the app
     * is unlocked afterwards (already unlocked, feature off, or the PIN was
     * accepted). Concurrent callers share one prompt.
     */
    async requestUnlock(
        options: Pick<
            ParentalLockPromptRequest,
            'titleKey' | 'descriptionKey'
        > = {}
    ): Promise<boolean> {
        // `enabled` is false until the settings have loaded; deciding "not
        // active" before that would open a gate during a slow startup.
        await this.initialize();
        if (!this.active()) {
            return true;
        }
        // A store that failed to read at startup may read now; do not send
        // the user through the PIN for categories that are not locked.
        await this.locks.ensureReadable();
        if (this.pendingUnlock) {
            return this.pendingUnlock;
        }
        this.pendingUnlock = this.promptForUnlock(options).finally(() => {
            this.pendingUnlock = null;
        });
        return this.pendingUnlock;
    }

    private async promptForUnlock(
        options: Pick<ParentalLockPromptRequest, 'titleKey' | 'descriptionKey'>
    ): Promise<boolean> {
        const hash = this.pinHash();
        if (!this.prompt || !hash) {
            return false;
        }
        const pin = await this.prompt.requestPin({
            mode: 'unlock',
            verify: (candidate) => verifyParentalLockPin(candidate, hash),
            ...options,
        });
        if (pin === null) {
            return false;
        }
        this.unlockedState.set(true);
        return true;
    }

    /** Locks immediately; the next locked surface needs the PIN again. */
    lock(): void {
        this.unlockedState.set(false);
    }

    /**
     * Sets a new PIN through the prompt and turns the feature on. The
     * parent who just typed the PIN stays unlocked. Returns whether it
     * happened.
     */
    async setupPin(): Promise<boolean> {
        await this.initialize();
        if (!this.prompt) {
            return false;
        }
        const pin = await this.prompt.requestPin({ mode: 'set' });
        if (pin === null) {
            return false;
        }
        if (!(await this.storePin(pin))) {
            return false;
        }
        this.unlockedState.set(true);
        if (!this.enabled() && !(await this.persistEnabled(true))) {
            this.unlockedState.set(false);
            return false;
        }
        return true;
    }

    /**
     * Persists the feature switch. `updateSettings` patches the in-memory
     * value before the write; on a failed write that patch is undone (the
     * second write fails the same way and is ignored), so the toggle
     * cannot show a state the next launch will not have, and the Electron
     * mirror is only updated for a persisted switch.
     */
    private async persistEnabled(enabled: boolean): Promise<boolean> {
        try {
            await this.settingsStore.updateSettings({
                parentalLockEnabled: enabled,
            });
        } catch (error) {
            console.error('Failed to persist the parental lock switch.', error);
            await this.settingsStore
                .updateSettings({ parentalLockEnabled: !enabled })
                .catch(() => undefined);
            return false;
        }
        mirrorParentalLockEnabledSetting(enabled);
        return true;
    }

    /** Verifies the current PIN, then replaces it. */
    async changePin(): Promise<boolean> {
        await this.initialize();
        if (!this.prompt || !this.hasPin()) {
            return false;
        }
        if (!(await this.verifyCurrentPin())) {
            return false;
        }
        const pin = await this.prompt.requestPin({ mode: 'set' });
        if (pin === null) {
            return false;
        }
        return this.storePin(pin);
    }

    /** Turns the feature off after the PIN was entered; locks are kept. */
    async disable(): Promise<boolean> {
        if (!this.enabled()) {
            return true;
        }
        if (!(await this.verifyCurrentPin())) {
            return false;
        }
        if (!(await this.persistEnabled(false))) {
            return false;
        }
        this.unlockedState.set(false);
        return true;
    }

    /**
     * Always asks for the PIN, unlocked session or not: changing the PIN or
     * switching the feature off must not be possible just because a parent
     * left the app unlocked. Unlike `requestUnlock()` this never short-cuts
     * on `active`.
     */
    private async verifyCurrentPin(): Promise<boolean> {
        await this.initialize();
        const hash = this.pinHash();
        if (!this.prompt || !hash) {
            return false;
        }
        const pin = await this.prompt.requestPin({
            mode: 'unlock',
            verify: (candidate) => verifyParentalLockPin(candidate, hash),
            titleKey: 'PARENTAL_LOCK.PIN_DIALOG.CONFIRM_TITLE',
            descriptionKey: 'PARENTAL_LOCK.PIN_DIALOG.CONFIRM_DESCRIPTION',
        });
        return pin !== null;
    }

    async setRelockMinutes(minutes: number): Promise<void> {
        await this.settingsStore.updateSettings({
            parentalLockRelockMinutes:
                normalizeParentalLockRelockMinutes(minutes),
        });
    }

    // -- Lock store (ParentalLockLockStore; predicates add `active`) -------

    locksFor(playlistId: string): ParentalLockPlaylistLocks {
        return this.locks.locksFor(playlistId);
    }

    lockedXtreamIds(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType
    ): number[] {
        return this.locks.lockedXtreamIds(playlistId, categoryType);
    }

    lockedStalkerIds(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType
    ): string[] {
        return this.locks.lockedStalkerIds(playlistId, categoryType);
    }

    lockedGroupTitles(playlistId: string): string[] {
        return this.locks.lockedGroupTitles(playlistId);
    }

    /** Whether the category is locked AND currently withheld. */
    isXtreamCategoryLocked(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        xtreamId: number
    ): boolean {
        return (
            this.active() &&
            (!this.locks.readable() ||
                this.lockedXtreamIds(playlistId, categoryType).includes(
                    xtreamId
                ))
        );
    }

    isStalkerCategoryLocked(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryId: string | number | null | undefined
    ): boolean {
        if (!this.active()) {
            return false;
        }
        // Fail-closed mode withholds rows without a genre too: "unknown
        // genre" is not "no locked genre" while the locks are unknown.
        if (!this.locks.readable()) {
            return true;
        }
        if (categoryId === null || categoryId === undefined) {
            return false;
        }
        return this.lockedStalkerIds(playlistId, categoryType).includes(
            String(categoryId)
        );
    }

    isM3uGroupLocked(playlistId: string, groupTitle: string): boolean {
        return (
            this.active() &&
            (!this.locks.readable() ||
                this.lockedGroupTitles(playlistId).includes(groupTitle))
        );
    }

    async setXtreamLocks(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        xtreamIds: number[]
    ): Promise<boolean> {
        await this.initialize();
        return this.locks.setXtreamLocks(playlistId, categoryType, xtreamIds);
    }

    async setStalkerLocks(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryIds: string[]
    ): Promise<boolean> {
        await this.initialize();
        return this.locks.setStalkerLocks(
            playlistId,
            categoryType,
            categoryIds
        );
    }

    async setM3uLocks(
        playlistId: string,
        groupTitles: string[]
    ): Promise<boolean> {
        await this.initialize();
        return this.locks.setM3uLocks(playlistId, groupTitles);
    }

    /** Backup restore: replaces every lock of one playlist. */
    async replacePlaylistLocks(
        playlistId: string,
        locks: ParentalLockPlaylistLocks
    ): Promise<boolean> {
        await this.initialize();
        return this.locks.replacePlaylistLocks(playlistId, locks);
    }

    /**
     * Re-stamps the Electron `categories.locked` index for a playlist from
     * the store, e.g. after a refresh recreated the rows.
     */
    stampXtreamLocks(
        playlistId: string,
        categoryTypes?: readonly ParentalLockXtreamCategoryType[]
    ): Promise<boolean> {
        return this.locks.stampXtreamLocks(playlistId, categoryTypes);
    }

    private async storePin(pin: string): Promise<boolean> {
        try {
            const hash = await hashParentalLockPin(pin);
            if (!(await this.storage.writePinHash(hash))) {
                return false;
            }
            this.pinHash.set(hash);
            return true;
        } catch (error) {
            console.error('Failed to store the parental lock PIN.', error);
            return false;
        }
    }
}
