import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { webcrypto } from 'node:crypto';
import { hashParentalLockPin } from '@iptvnator/shared/interfaces';
import { DatabaseService } from '../database-electron.service';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { SettingsStore } from '../settings-store.service';
import {
    PARENTAL_LOCK_PROMPT,
    ParentalLockPromptRequest,
} from './parental-lock-prompt.token';
import { ParentalLockStorageService } from './parental-lock-storage';
import { ParentalLockService } from './parental-lock.service';

describe('ParentalLockService', () => {
    const originalElectron = window.electron;
    let parentalLockEnabled: ReturnType<typeof signal<boolean>>;
    let parentalLockRelockMinutes: ReturnType<typeof signal<number>>;
    let storageFailure: ReturnType<typeof signal<'load' | 'save' | null>>;
    let updateSettings: jest.Mock;
    let storage: {
        pinHash: string | null;
        locks: Record<string, unknown>;
        readPinHash: jest.Mock;
        writePinHash: jest.Mock;
        readLocks: jest.Mock;
        writeLocks: jest.Mock;
    };
    let prompt: { requestPin: jest.Mock };
    let setCategoryLocks: jest.Mock;
    let setParentalLockState: jest.Mock;
    let updateBridgeSettings: jest.Mock;

    beforeAll(() => {
        if (!globalThis.crypto?.subtle) {
            Object.defineProperty(globalThis, 'crypto', {
                configurable: true,
                value: webcrypto,
            });
        }
    });

    beforeEach(() => {
        parentalLockEnabled = signal(false);
        parentalLockRelockMinutes = signal(15);
        storageFailure = signal<'load' | 'save' | null>(null);
        updateSettings = jest.fn(async (patch: Record<string, unknown>) => {
            if ('parentalLockEnabled' in patch) {
                parentalLockEnabled.set(patch['parentalLockEnabled'] === true);
            }
            if ('parentalLockRelockMinutes' in patch) {
                parentalLockRelockMinutes.set(
                    patch['parentalLockRelockMinutes'] as number
                );
            }
        });
        storage = {
            pinHash: null,
            locks: {},
            readPinHash: jest.fn(async () => storage.pinHash),
            writePinHash: jest.fn(async (hash: string) => {
                storage.pinHash = hash;
                return true;
            }),
            readLocks: jest.fn(async () => storage.locks),
            writeLocks: jest.fn(async (locks: Record<string, unknown>) => {
                storage.locks = locks;
                return true;
            }),
        };
        prompt = { requestPin: jest.fn() };
        setCategoryLocks = jest.fn(async () => true);
        setParentalLockState = jest.fn(async () => undefined);
        updateBridgeSettings = jest.fn(async () => undefined);
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: {
                setParentalLockState,
                updateSettings: updateBridgeSettings,
            },
        });

        TestBed.configureTestingModule({
            providers: [
                ParentalLockService,
                {
                    provide: SettingsStore,
                    useValue: {
                        parentalLockEnabled,
                        parentalLockRelockMinutes,
                        storageFailure,
                        loadSettings: jest.fn(async () => undefined),
                        updateSettings,
                    },
                },
                { provide: ParentalLockStorageService, useValue: storage },
                { provide: PARENTAL_LOCK_PROMPT, useValue: prompt },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: true },
                },
                { provide: DatabaseService, useValue: { setCategoryLocks } },
            ],
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    async function createService(): Promise<ParentalLockService> {
        const service = TestBed.inject(ParentalLockService);
        await service.initialize();
        TestBed.flushEffects();
        return service;
    }

    it('is inactive while the feature is off and reports that to the main process', async () => {
        const service = await createService();

        expect(service.enabled()).toBe(false);
        expect(service.active()).toBe(false);
        expect(service.hasPin()).toBe(false);
        expect(setParentalLockState).toHaveBeenLastCalledWith(false);
        await expect(service.requestUnlock()).resolves.toBe(true);
        expect(prompt.requestPin).not.toHaveBeenCalled();
    });

    it('stands in the stored PIN for the switch when settings could not be read', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        storageFailure.set('load');
        // Defaults-by-failure: the store reports the feature as off.
        parentalLockEnabled.set(false);

        const service = await createService();

        expect(service.enabled()).toBe(true);
        expect(service.active()).toBe(true);
        expect(setParentalLockState).toHaveBeenLastCalledWith(true);
    });

    it('never announces an unlocked state on unreadable settings without a PIN', async () => {
        storageFailure.set('load');

        const service = await createService();

        expect(service.enabled()).toBe(false);
        expect(setParentalLockState).not.toHaveBeenCalled();
    });

    it('withholds every category while the lock store cannot be read', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        parentalLockEnabled.set(true);
        storage.readLocks.mockResolvedValue(null);

        const service = await createService();

        expect(service.active()).toBe(true);
        expect(service.withholdsEverything()).toBe(true);
        expect(service.isXtreamCategoryLocked('p', 'live', 1)).toBe(true);
        expect(service.isStalkerCategoryLocked('p', 'itv', '1')).toBe(true);
        expect(service.isM3uGroupLocked('p', 'News')).toBe(true);
        // Nothing is known about the persisted locks: a write built on the
        // empty in-memory store would wipe them.
        await expect(service.setM3uLocks('p', ['Adult'])).resolves.toBe(false);
        expect(storage.writeLocks).not.toHaveBeenCalled();

        // The store reads again: the real locks apply and writes resume.
        storage.readLocks.mockResolvedValue({
            p: { xtream: [], stalker: [], m3u: ['Adult'] },
        });
        await expect(service.setM3uLocks('p', ['Adult', 'XXX'])).resolves.toBe(
            true
        );
        TestBed.flushEffects();
        expect(service.withholdsEverything()).toBe(false);
        expect(service.isM3uGroupLocked('p', 'News')).toBe(false);
        expect(service.isM3uGroupLocked('p', 'XXX')).toBe(true);
    });

    it('starts locked with the feature on and unlocks through the prompt', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        parentalLockEnabled.set(true);
        prompt.requestPin.mockImplementation(
            async (request: ParentalLockPromptRequest) =>
                (await request.verify?.('1234')) ? '1234' : null
        );
        const service = await createService();

        expect(service.active()).toBe(true);
        expect(setParentalLockState).toHaveBeenLastCalledWith(true);

        const unlocked = service.requestUnlock();
        const concurrent = service.requestUnlock();
        await expect(unlocked).resolves.toBe(true);
        await expect(concurrent).resolves.toBe(true);
        expect(prompt.requestPin).toHaveBeenCalledTimes(1);
        TestBed.flushEffects();
        expect(service.unlocked()).toBe(true);
        expect(service.active()).toBe(false);
        expect(setParentalLockState).toHaveBeenLastCalledWith(false);

        service.lock();
        TestBed.flushEffects();
        expect(service.active()).toBe(true);
        expect(setParentalLockState).toHaveBeenLastCalledWith(true);
    });

    it('does not open a gate before the settings have loaded', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        prompt.requestPin.mockResolvedValue(null);
        let releaseSettings!: () => void;
        const settingsStore = TestBed.inject(SettingsStore) as unknown as {
            loadSettings: jest.Mock;
        };
        settingsStore.loadSettings.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseSettings = () => {
                        parentalLockEnabled.set(true);
                        resolve();
                    };
                })
        );
        const service = TestBed.inject(ParentalLockService);
        void service.initialize();

        // Enabled is still the default false here: the answer must wait for
        // the load instead of reading that as "feature off".
        const gate = service.requestUnlock();
        releaseSettings();
        await expect(gate).resolves.toBe(false);
        expect(prompt.requestPin).toHaveBeenCalledTimes(1);
    });

    it('stays locked when the prompt is dismissed', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        parentalLockEnabled.set(true);
        prompt.requestPin.mockResolvedValue(null);
        const service = await createService();

        await expect(service.requestUnlock()).resolves.toBe(false);
        expect(service.active()).toBe(true);
    });

    it('setupPin stores a hash, enables the feature and leaves the parent unlocked', async () => {
        prompt.requestPin.mockResolvedValue('9876');
        const service = await createService();

        await expect(service.setupPin()).resolves.toBe(true);
        TestBed.flushEffects();

        expect(storage.writePinHash).toHaveBeenCalledTimes(1);
        expect(storage.pinHash).not.toContain('9876');
        expect(updateSettings).toHaveBeenCalledWith({
            parentalLockEnabled: true,
        });
        expect(updateBridgeSettings).toHaveBeenCalledWith({
            parentalLockEnabled: true,
        });
        expect(service.enabled()).toBe(true);
        expect(service.unlocked()).toBe(true);
        expect(service.hasPin()).toBe(true);
    });

    it('disable requires the PIN and keeps the locks', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        storage.locks = { 'p-1': { m3u: ['Adult'] } };
        parentalLockEnabled.set(true);
        prompt.requestPin.mockResolvedValueOnce(null);
        const service = await createService();

        await expect(service.disable()).resolves.toBe(false);
        expect(service.enabled()).toBe(true);

        prompt.requestPin.mockResolvedValueOnce('1234');
        await expect(service.disable()).resolves.toBe(true);
        expect(service.enabled()).toBe(false);
        expect(service.lockedGroupTitles('p-1')).toEqual(['Adult']);
    });

    it('arms the idle timer for the session that just enabled the feature', async () => {
        jest.useFakeTimers();
        try {
            prompt.requestPin.mockResolvedValue('9876');
            parentalLockRelockMinutes.set(5);
            const service = await createService();

            await expect(service.setupPin()).resolves.toBe(true);
            TestBed.flushEffects();
            expect(service.unlocked()).toBe(true);

            // `active` never changed (unlocked before and after enabling), so
            // the timer must be armed by the unlocked transition itself.
            jest.advanceTimersByTime(5 * 60_000 + 1_500);
            TestBed.flushEffects();
            expect(service.unlocked()).toBe(false);
            expect(service.active()).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it('changePin and disable verify the stored PIN even while the session is unlocked', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        parentalLockEnabled.set(true);
        prompt.requestPin.mockImplementation(
            async (request: ParentalLockPromptRequest) =>
                request.mode === 'set'
                    ? '5678'
                    : (await request.verify?.('1234'))
                      ? '1234'
                      : null
        );
        const service = await createService();
        await service.requestUnlock();
        TestBed.flushEffects();
        expect(service.unlocked()).toBe(true);
        prompt.requestPin.mockClear();

        // A dismissed verification prompt aborts the change.
        prompt.requestPin.mockResolvedValueOnce(null);
        await expect(service.changePin()).resolves.toBe(false);
        expect(prompt.requestPin).toHaveBeenCalledTimes(1);
        expect(prompt.requestPin.mock.calls[0][0].mode).toBe('unlock');
        expect(storage.writePinHash).not.toHaveBeenCalled();

        prompt.requestPin.mockClear();
        await expect(service.changePin()).resolves.toBe(true);
        expect(
            prompt.requestPin.mock.calls.map((call) => call[0].mode)
        ).toEqual(['unlock', 'set']);
        expect(storage.writePinHash).toHaveBeenCalledTimes(1);

        prompt.requestPin.mockClear();
        prompt.requestPin.mockResolvedValueOnce(null);
        await expect(service.disable()).resolves.toBe(false);
        expect(service.enabled()).toBe(true);
        expect(prompt.requestPin.mock.calls[0][0].mode).toBe('unlock');
    });

    it('persists locks per portal, stamps the Xtream column and bumps the version', async () => {
        const service = await createService();
        const versionBefore = service.version();

        await expect(
            service.setXtreamLocks('p-1', 'live', [3, 3, 9])
        ).resolves.toBe(true);
        await expect(
            service.setStalkerLocks('p-2', 'itv', ['12'])
        ).resolves.toBe(true);
        await expect(service.setM3uLocks('p-3', ['XXX'])).resolves.toBe(true);

        expect(setCategoryLocks).toHaveBeenCalledWith('p-1', 'live', [3, 9]);
        expect(service.lockedXtreamIds('p-1', 'live')).toEqual([3, 9]);
        expect(service.lockedXtreamIds('p-1', 'movies')).toEqual([]);
        expect(service.lockedStalkerIds('p-2', 'itv')).toEqual(['12']);
        expect(service.lockedGroupTitles('p-3')).toEqual(['XXX']);
        expect(service.version()).toBeGreaterThan(versionBefore);
        expect(storage.writeLocks).toHaveBeenCalledTimes(3);
    });

    it('answers "locked" only while the lock is active', async () => {
        storage.pinHash = await hashParentalLockPin('1234');
        storage.locks = {
            'p-1': {
                xtream: [{ categoryType: 'live', xtreamId: 3 }],
                stalker: [{ categoryType: 'vod', categoryId: '7' }],
                m3u: ['XXX'],
            },
        };
        parentalLockEnabled.set(true);
        prompt.requestPin.mockResolvedValue('1234');
        const service = await createService();

        expect(service.isXtreamCategoryLocked('p-1', 'live', 3)).toBe(true);
        expect(service.isXtreamCategoryLocked('p-1', 'live', 4)).toBe(false);
        expect(service.isStalkerCategoryLocked('p-1', 'vod', 7)).toBe(true);
        expect(service.isM3uGroupLocked('p-1', 'XXX')).toBe(true);

        await service.requestUnlock();
        expect(service.isXtreamCategoryLocked('p-1', 'live', 3)).toBe(false);
        expect(service.isM3uGroupLocked('p-1', 'XXX')).toBe(false);
    });

    it('replacePlaylistLocks re-stamps every Xtream type', async () => {
        const service = await createService();

        await service.replacePlaylistLocks('p-1', {
            xtream: [{ categoryType: 'movies', xtreamId: 5 }],
            stalker: [],
            m3u: [],
        });

        expect(setCategoryLocks).toHaveBeenCalledWith('p-1', 'live', []);
        expect(setCategoryLocks).toHaveBeenCalledWith('p-1', 'movies', [5]);
        expect(setCategoryLocks).toHaveBeenCalledWith('p-1', 'series', []);
    });
});
