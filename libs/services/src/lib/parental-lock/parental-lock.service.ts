import {
    computed,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import {
    createParentalLockPinThrottle,
    hashParentalLockPin,
    normalizeParentalLockRelockMinutes,
    ParentalLockPlaylistLocks,
    ParentalLockStalkerCategoryType,
    ParentalLockXtreamCategoryType,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { SettingsStore } from '../settings-store.service';
import { ParentalLockIdleTimer } from './parental-lock-idle-timer';
import {
    LockListEdit,
    ParentalLockLockStore,
} from './parental-lock-lock-store.service';
import {
    PARENTAL_LOCK_PROMPT,
    ParentalLockPromptRequest,
} from './parental-lock-prompt.token';
import {
    isParentalLockWorkerFilterMissing,
    ParentalLockWorkerSync,
} from './parental-lock-bridge';
import {
    ensureParentalLockSettingsReadable,
    persistParentalLockEnabled,
    persistParentalLockRelockMinutes,
} from './parental-lock-settings-writer';
import {
    confirmPinRequest,
    NEW_PIN_REQUEST,
    PARENTAL_LOCK_SUBMIT_KEYS,
    unlockPinRequest,
} from './parental-lock-prompt-requests';
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
    /**
     * Electron reads Xtream through the SQLite worker, but the bridge lacks
     * the lock-state or index IPC (a partial or older preload): the worker
     * cannot withhold locked rows, so the locked session withholds all.
     */
    private readonly workerFilterMissing = isParentalLockWorkerFilterMissing(
        inject(RuntimeCapabilitiesService)
    );

    private readonly unlockedState = signal(false);
    /** Shared by every unlock prompt: a reopened dialog keeps the cooldown. */
    private readonly pinThrottle = createParentalLockPinThrottle();
    private readonly pinHash = signal<string | null>(null);
    /** The PIN hash could not be read; retried before PIN-protected steps. */
    private readonly pinUnreadable = signal(false);
    private readonly versionState = signal(0);
    private readonly workerSync = new ParentalLockWorkerSync();
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
            ? this.pinHash() !== null || this.pinUnreadable()
            : this.settingsStore.parentalLockEnabled?.() === true
    );
    /** Feature on and the PIN has been entered this session. */
    readonly unlocked = computed(() => this.enabled() && this.unlockedState());
    /** Locked categories must currently be withheld. */
    readonly active = computed(() => this.enabled() && !this.unlockedState());
    /** A PIN exists; enabling is only possible once this is true. */
    readonly hasPin = computed(() => this.pinHash() !== null);
    /** The lock store is read and trustworthy; backups must not run without it. */
    readonly locksReadable = computed(() => this.locks.readable());
    /**
     * Locked, and the lock store could not be read: which categories are
     * locked is unknown, so EVERY category is withheld — the renderer-side
     * filters treat every id as locked — until the PIN is entered or the
     * store reads again. Failing toward "nothing is locked" would expose the
     * protected content precisely during a storage failure.
     */
    readonly withholdsEverything = computed(
        () =>
            this.active() &&
            (this.workerFilterMissing ||
                this.workerSync.failed() ||
                !this.locks.readable())
    );
    /** Bumps whenever `active` or the lock store changes; consumers re-query. */
    readonly version = computed(
        () =>
            this.versionState() +
            this.locks.revision() +
            this.workerSync.changes()
    );
    readonly relockMinutes = computed(() =>
        normalizeParentalLockRelockMinutes(
            this.settingsStore.parentalLockRelockMinutes?.()
        )
    );

    constructor() {
        // Lock edits that take a lock away need an unlocked session at the
        // moment they commit, not only when their editor opened.
        this.locks.setRemovalGate(() => !this.active());
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
                    void this.workerSync.sync(active, () => this.active());
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
                const [pinRead] = await Promise.all([
                    this.storage.readPinHash(),
                    this.locks.load(),
                    this.settingsStore.loadSettings(),
                ]);
                this.applyPinRead(pinRead);
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
        await this.ensurePin();
        const hash = this.pinHash();
        if (!this.prompt || !hash) {
            return false;
        }
        const pin = await this.prompt.requestPin(
            unlockPinRequest(hash, this.pinThrottle, options)
        );
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
        if (!this.prompt || !(await this.ensureSettingsReadable())) {
            return false;
        }
        // Decided BEFORE the PIN is stored: with the settings switch
        // unknown, `enabled` follows `hasPin`, and would read as on the
        // moment the PIN lands — skipping the persistence the next launch
        // depends on.
        const needsPersist =
            this.settingsStore.parentalLockEnabled?.() !== true;
        const pin = await this.prompt.requestPin(NEW_PIN_REQUEST);
        if (pin === null) {
            return false;
        }
        if (!(await this.storePin(pin))) {
            return false;
        }
        this.unlockedState.set(true);
        if (needsPersist && !(await this.persistEnabled(true))) {
            this.unlockedState.set(false);
            return false;
        }
        return true;
    }

    private persistEnabled(enabled: boolean): Promise<boolean> {
        return persistParentalLockEnabled(this.settingsStore, enabled);
    }

    private ensureSettingsReadable(): Promise<boolean> {
        return ensureParentalLockSettingsReadable(this.settingsStore);
    }

    /** Verifies the current PIN, then replaces it. */
    async changePin(): Promise<boolean> {
        await this.initialize();
        await this.ensurePin();
        if (!this.prompt || !this.hasPin()) {
            return false;
        }
        if (!(await this.verifyCurrentPin(PARENTAL_LOCK_SUBMIT_KEYS.confirm))) {
            return false;
        }
        const pin = await this.prompt.requestPin(NEW_PIN_REQUEST);
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
        if (!(await this.verifyCurrentPin(PARENTAL_LOCK_SUBMIT_KEYS.turnOff))) {
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
     * on `active`. `submitKey` names the step the PIN confirms.
     */
    private async verifyCurrentPin(submitKey: string): Promise<boolean> {
        await this.initialize();
        await this.ensurePin();
        const hash = this.pinHash();
        if (!this.prompt || !hash) {
            return false;
        }
        const pin = await this.prompt.requestPin(
            confirmPinRequest(hash, this.pinThrottle, submitKey)
        );
        return pin !== null;
    }

    /**
     * False when the value could not be persisted; the in-memory patch
     * `updateSettings` applied before the failed write is undone so the
     * timer on screen never differs from the one the next launch uses.
     */
    async setRelockMinutes(minutes: number): Promise<boolean> {
        // A locked session must not lengthen or switch off its own relock
        // timer (Settings disables the selector until the PIN is entered).
        if (this.active()) {
            return false;
        }
        return persistParentalLockRelockMinutes(
            this.settingsStore,
            minutes,
            () => this.relockMinutes()
        );
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
            (this.withholdsEverything() ||
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
        if (this.withholdsEverything()) {
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
            (this.withholdsEverything() ||
                this.lockedGroupTitles(playlistId).includes(groupTitle))
        );
    }

    async setXtreamLocks(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        xtreamIds: LockListEdit<number>
    ): Promise<boolean> {
        await this.initialize();
        return this.locks.setXtreamLocks(playlistId, categoryType, xtreamIds);
    }

    async setStalkerLocks(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryIds: LockListEdit<string>
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
        groupTitles: LockListEdit<string>
    ): Promise<boolean> {
        await this.initialize();
        return this.locks.setM3uLocks(playlistId, groupTitles);
    }

    /** Retries a failed lock-store read; false while it still fails. */
    async ensureLocksReadable(): Promise<boolean> {
        await this.initialize();
        return this.locks.ensureReadable();
    }

    /** Playlist deletion: its locks leave the store. */
    async removePlaylistLocks(playlistId: string): Promise<boolean> {
        await this.initialize();
        return this.locks.removePlaylist(playlistId);
    }

    /** "Remove all playlists": the whole lock store is emptied. */
    async clearAllLocks(): Promise<boolean> {
        await this.initialize();
        return this.locks.clearAll();
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

    private applyPinRead(read: { hash: string | null } | null): void {
        if (read === null) {
            console.error('The parental lock PIN could not be read.');
            this.pinUnreadable.set(true);
            return;
        }
        this.pinHash.set(read.hash);
        this.pinUnreadable.set(false);
    }

    /**
     * Retries a PIN read that failed at startup. A failed read is not an
     * absent PIN: the session stays locked (`enabled` treats it as set),
     * and every PIN-protected step re-reads first so the parent can still
     * unlock, change the PIN or switch the feature off once storage answers.
     */
    private async ensurePin(): Promise<void> {
        if (!this.pinUnreadable()) {
            return;
        }
        this.applyPinRead(await this.storage.readPinHash());
    }

    private async storePin(pin: string): Promise<boolean> {
        try {
            const hash = await hashParentalLockPin(pin);
            if (!(await this.storage.writePinHash(hash))) {
                return false;
            }
            this.pinHash.set(hash);
            this.pinUnreadable.set(false);
            return true;
        } catch (error) {
            console.error('Failed to store the parental lock PIN.', error);
            return false;
        }
    }
}
