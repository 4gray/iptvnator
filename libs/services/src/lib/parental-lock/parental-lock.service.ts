import {
    computed,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import {
    createEmptyParentalLockPlaylistLocks,
    hashParentalLockPin,
    isParentalLockPlaylistLocksEmpty,
    lockedStalkerCategoryIds,
    lockedXtreamCategoryIds,
    normalizeParentalLockPlaylistLocks,
    normalizeParentalLockRelockMinutes,
    ParentalLockPlaylistLocks,
    ParentalLockStalkerCategoryType,
    ParentalLockStore,
    ParentalLockXtreamCategoryType,
    verifyParentalLockPin,
} from '@iptvnator/shared/interfaces';
import { DatabaseService } from '../database-electron.service';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { SettingsStore } from '../settings-store.service';
import { ParentalLockIdleTimer } from './parental-lock-idle-timer';
import {
    PARENTAL_LOCK_PROMPT,
    ParentalLockPromptRequest,
} from './parental-lock-prompt.token';
import { ParentalLockStorageService } from './parental-lock-storage';

const XTREAM_CATEGORY_TYPES: readonly ParentalLockXtreamCategoryType[] = [
    'live',
    'movies',
    'series',
];

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
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly databaseService = inject(DatabaseService);
    private readonly prompt = inject(PARENTAL_LOCK_PROMPT, { optional: true });

    private readonly unlockedState = signal(false);
    private readonly pinHash = signal<string | null>(null);
    private readonly lockStore = signal<ParentalLockStore>({});
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

    /** The feature switch from settings. */
    readonly enabled = computed(
        () => this.settingsStore.parentalLockEnabled?.() === true
    );
    /** Feature on and the PIN has been entered this session. */
    readonly unlocked = computed(
        () => this.enabled() && this.unlockedState()
    );
    /** Locked categories must currently be withheld. */
    readonly active = computed(() => this.enabled() && !this.unlockedState());
    /** A PIN exists; enabling is only possible once this is true. */
    readonly hasPin = computed(() => this.pinHash() !== null);
    /** Bumps whenever `active` or the lock store changes; consumers re-query. */
    readonly version = this.versionState.asReadonly();
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
                this.syncMainProcess(active);
                if (!active) {
                    this.idleTimer.arm(this.enabled() ? this.relockMinutes() : 0);
                } else {
                    this.idleTimer.disarm();
                }
            });
        });
        effect(() => {
            const minutes = this.relockMinutes();
            untracked(() => {
                if (this.unlocked()) {
                    this.idleTimer.arm(minutes);
                }
            });
        });
    }

    /** Loads the persisted PIN hash and lock store once. */
    initialize(): Promise<void> {
        if (!this.initialization) {
            this.initialization = (async () => {
                const [pinHash, locks] = await Promise.all([
                    this.storage.readPinHash(),
                    this.storage.readLocks(),
                    this.settingsStore.loadSettings(),
                ]);
                this.pinHash.set(pinHash);
                this.lockStore.set(locks);
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
    requestUnlock(
        options: Pick<ParentalLockPromptRequest, 'titleKey' | 'descriptionKey'> = {}
    ): Promise<boolean> {
        if (!this.active()) {
            return Promise.resolve(true);
        }
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
        await this.initialize();
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
        if (!this.enabled()) {
            await this.settingsStore.updateSettings({
                parentalLockEnabled: true,
            });
            this.mirrorEnabledSetting(true);
        }
        return true;
    }

    /** Verifies the current PIN, then replaces it. */
    async changePin(): Promise<boolean> {
        await this.initialize();
        if (!this.prompt || !this.hasPin()) {
            return false;
        }
        if (this.enabled() && !(await this.requestUnlock())) {
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
        if (!(await this.requestUnlock())) {
            return false;
        }
        await this.settingsStore.updateSettings({
            parentalLockEnabled: false,
        });
        this.mirrorEnabledSetting(false);
        this.unlockedState.set(false);
        return true;
    }

    async setRelockMinutes(minutes: number): Promise<void> {
        await this.settingsStore.updateSettings({
            parentalLockRelockMinutes:
                normalizeParentalLockRelockMinutes(minutes),
        });
    }

    // -- Lock store -------------------------------------------------------

    locksFor(playlistId: string): ParentalLockPlaylistLocks {
        return (
            this.lockStore()[playlistId] ??
            createEmptyParentalLockPlaylistLocks()
        );
    }

    lockedXtreamIds(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType
    ): number[] {
        return lockedXtreamCategoryIds(
            this.lockStore()[playlistId],
            categoryType
        );
    }

    lockedStalkerIds(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType
    ): string[] {
        return lockedStalkerCategoryIds(
            this.lockStore()[playlistId],
            categoryType
        );
    }

    lockedGroupTitles(playlistId: string): string[] {
        return this.lockStore()[playlistId]?.m3u ?? [];
    }

    /** Whether the category is locked AND currently withheld. */
    isXtreamCategoryLocked(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        xtreamId: number
    ): boolean {
        return (
            this.active() &&
            this.lockedXtreamIds(playlistId, categoryType).includes(xtreamId)
        );
    }

    isStalkerCategoryLocked(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryId: string | number | null | undefined
    ): boolean {
        if (categoryId === null || categoryId === undefined) {
            return false;
        }
        return (
            this.active() &&
            this.lockedStalkerIds(playlistId, categoryType).includes(
                String(categoryId)
            )
        );
    }

    isM3uGroupLocked(playlistId: string, groupTitle: string): boolean {
        return (
            this.active() && this.lockedGroupTitles(playlistId).includes(groupTitle)
        );
    }

    async setXtreamLocks(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        xtreamIds: number[]
    ): Promise<boolean> {
        const current = this.locksFor(playlistId);
        const next: ParentalLockPlaylistLocks = {
            ...current,
            xtream: [
                ...current.xtream.filter(
                    (entry) => entry.categoryType !== categoryType
                ),
                ...[...new Set(xtreamIds)].map((xtreamId) => ({
                    categoryType,
                    xtreamId,
                })),
            ],
        };
        if (!(await this.persistPlaylistLocks(playlistId, next))) {
            return false;
        }
        return this.stampXtreamLocks(playlistId, [categoryType]);
    }

    async setStalkerLocks(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryIds: string[]
    ): Promise<boolean> {
        const current = this.locksFor(playlistId);
        return this.persistPlaylistLocks(playlistId, {
            ...current,
            stalker: [
                ...current.stalker.filter(
                    (entry) => entry.categoryType !== categoryType
                ),
                ...[...new Set(categoryIds)].map((categoryId) => ({
                    categoryType,
                    categoryId,
                })),
            ],
        });
    }

    async setM3uLocks(
        playlistId: string,
        groupTitles: string[]
    ): Promise<boolean> {
        return this.persistPlaylistLocks(playlistId, {
            ...this.locksFor(playlistId),
            m3u: [...new Set(groupTitles)],
        });
    }

    /** Backup restore: replaces every lock of one playlist. */
    async replacePlaylistLocks(
        playlistId: string,
        locks: ParentalLockPlaylistLocks
    ): Promise<boolean> {
        if (!(await this.persistPlaylistLocks(playlistId, locks))) {
            return false;
        }
        return this.stampXtreamLocks(playlistId, XTREAM_CATEGORY_TYPES);
    }

    /**
     * Re-stamps the Electron `categories.locked` index for a playlist from
     * the store, e.g. after a refresh recreated the rows.
     */
    async stampXtreamLocks(
        playlistId: string,
        categoryTypes: readonly ParentalLockXtreamCategoryType[] = XTREAM_CATEGORY_TYPES
    ): Promise<boolean> {
        if (!this.runtime.supportsXtreamSqliteDataSource) {
            return true;
        }
        let success = true;
        for (const categoryType of categoryTypes) {
            success =
                (await this.databaseService.setCategoryLocks(
                    playlistId,
                    categoryType,
                    this.lockedXtreamIds(playlistId, categoryType)
                )) && success;
        }
        return success;
    }

    private async persistPlaylistLocks(
        playlistId: string,
        locks: ParentalLockPlaylistLocks
    ): Promise<boolean> {
        await this.initialize();
        const normalized = normalizeParentalLockPlaylistLocks(locks);
        const next: ParentalLockStore = { ...this.lockStore() };
        if (isParentalLockPlaylistLocksEmpty(normalized)) {
            delete next[playlistId];
        } else {
            next[playlistId] = normalized;
        }
        if (!(await this.storage.writeLocks(next))) {
            return false;
        }
        this.lockStore.set(next);
        this.versionState.update((value) => value + 1);
        return true;
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

    private syncMainProcess(active: boolean): void {
        const bridge = window.electron;
        if (typeof bridge?.setParentalLockState !== 'function') {
            return;
        }
        void bridge.setParentalLockState(active).catch((error) => {
            console.error('Failed to sync the parental lock state.', error);
        });
    }

    private mirrorEnabledSetting(enabled: boolean): void {
        const bridge = window.electron;
        if (typeof bridge?.updateSettings !== 'function') {
            return;
        }
        void bridge
            .updateSettings({ parentalLockEnabled: enabled })
            .catch(() => undefined);
    }
}
