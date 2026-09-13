import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { webcrypto } from 'node:crypto';
import { hashParentalLockPin } from '@iptvnator/shared/interfaces';
import { DatabaseService } from '../database-electron.service';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { SettingsStore } from '../settings-store.service';
import { PARENTAL_LOCK_PROMPT, ParentalLockPromptRequest } from './parental-lock-prompt.token';
import { ParentalLockStorageService } from './parental-lock-storage';
import { ParentalLockService } from './parental-lock.service';

describe('ParentalLockService', () => {
    const originalElectron = window.electron;
    let parentalLockEnabled: ReturnType<typeof signal<boolean>>;
    let parentalLockRelockMinutes: ReturnType<typeof signal<number>>;
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
        expect(updateSettings).toHaveBeenCalledWith({ parentalLockEnabled: true });
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
