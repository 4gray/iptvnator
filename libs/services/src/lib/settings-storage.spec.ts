import { type Settings, STORE_KEY } from '@iptvnator/shared/interfaces';
import { type DestroyableInjector, Injector } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { EpgPreferencesService } from './epg-preferences.service';
import { EpgSourceSettingsService } from './epg-source-settings.service';
import { writeSettings, writeTransferredTmdbKey } from './settings-storage';
import { DEFAULT_SETTINGS } from './settings-store.defaults';
import { SettingsStore } from './settings-store.service';

const apiKey = 'synthetic-received-key';
const saved = {
    showCaptions: false,
    tmdb: { enabled: false, apiKey: ' synthetic-old-key ' },
};

type Callback = () => void;

describe('Settings storage', () => {
    let storage: {
        backingEngine: string;
        backingStore: { database: string; store: string };
        get: jest.Mock;
    };
    let storedSettings: Partial<Settings>;
    let injector: DestroyableInjector | undefined;
    let openDatabase: jest.Mock;
    let originalIndexedDb: PropertyDescriptor | undefined;
    let open: {
        result: { transaction: jest.Mock; close: jest.Mock };
        transaction: { abort: jest.Mock };
        onsuccess?: Callback;
        onerror?: Callback;
        onupgradeneeded?: Callback;
    };
    let transaction: { onabort?: Callback; oncomplete?: Callback };
    let read: { result: typeof saved | undefined; onsuccess?: Callback };
    let put: jest.Mock;
    let begin: jest.Mock;
    let abortUpgrade: jest.Mock;

    const storageMap = () => storage as unknown as StorageMap;
    const transfer = (
        key: string,
        expected: string,
        isCurrent: () => boolean
    ) => writeTransferredTmdbKey(storageMap(), key, expected, isCurrent);

    async function loadStore() {
        injector = Injector.create({
            providers: [
                SettingsStore,
                EpgPreferencesService,
                {
                    provide: EpgSourceSettingsService,
                    useValue: {
                        synchronize: jest.fn().mockResolvedValue(undefined),
                    },
                },
                { provide: StorageMap, useValue: storage },
            ],
        });
        const store = injector.get(SettingsStore);
        await store.loadSettings();
        return store;
    }

    function waitForOpen() {
        return new Promise<void>((resolve) => {
            openDatabase.mockImplementationOnce(() => {
                resolve();
                return open;
            });
        });
    }

    beforeEach(() => {
        storedSettings = saved;
        storage = {
            backingEngine: 'indexedDB',
            backingStore: { database: 'synthetic-db', store: 'settings' },
            get: jest.fn(() => of(storedSettings)),
        };
        read = { result: saved };
        put = jest.fn();
        transaction = {};
        begin = jest.fn(() =>
            Object.assign(transaction, {
                objectStore: () => ({ get: () => read, put }),
            })
        );
        abortUpgrade = jest.fn();
        open = {
            result: { transaction: begin, close: jest.fn() },
            transaction: { abort: abortUpgrade },
        };
        openDatabase = jest.fn(() => open);
        originalIndexedDb = Object.getOwnPropertyDescriptor(
            globalThis,
            'indexedDB'
        );
        Object.defineProperty(globalThis, 'indexedDB', {
            configurable: true,
            value: { open: openDatabase },
        });
    });

    afterEach(() => {
        injector?.destroy();
        injector = undefined;
        if (originalIndexedDb)
            Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
    });

    it('refuses to transfer a key into memory-only storage', async () => {
        storage.backingEngine = 'memory';
        await expect(transfer(apiKey, '', () => true)).rejects.toThrow(
            'Could not save'
        );
    });

    it('reads the current key in the transaction that saves unrelated settings', async () => {
        const draft = {
            ...DEFAULT_SETTINGS,
            showCaptions: true,
            tmdb: { enabled: true },
        };
        const writing = writeSettings(storageMap(), draft, true);
        open.onsuccess?.();
        read.onsuccess?.();
        expect(put).toHaveBeenCalledWith(
            { ...draft, tmdb: { enabled: true, apiKey: saved.tmdb.apiKey } },
            STORE_KEY.Settings
        );
        transaction.oncomplete?.();
        await expect(writing).resolves.toBe(saved.tmdb.apiKey);
    });

    it('writes an explicit key removal instead of preserving the stored key', async () => {
        const draft = {
            ...DEFAULT_SETTINGS,
            tmdb: { enabled: true, apiKey: '' },
        };
        const writing = writeSettings(storageMap(), draft, false);
        open.onsuccess?.();
        read.onsuccess?.();
        expect(put).toHaveBeenCalledWith(draft, STORE_KEY.Settings);
        transaction.oncomplete?.();
        await expect(writing).resolves.toBe('');
    });

    it('refreshes an ordinary save from a stale tab only when the write commits', async () => {
        const store = await loadStore();
        read.result = { ...saved, tmdb: { ...saved.tmdb, apiKey } };
        const opened = waitForOpen();
        const writing = store.updateSettings({ showCaptions: true });
        await opened;
        open.onsuccess?.();
        read.onsuccess?.();
        expect(put).toHaveBeenCalledWith(
            expect.objectContaining({
                showCaptions: true,
                tmdb: { enabled: false, apiKey },
            }),
            STORE_KEY.Settings
        );
        expect(store.tmdb?.()?.apiKey).toBe(saved.tmdb.apiKey);
        transaction.oncomplete?.();
        await writing;
        expect(store.tmdb?.()?.apiKey).toBe(apiKey);
    });

    it.each([true, false])(
        'reflects the latest persisted key when a transfer commits=%s',
        async (commits) => {
            const store = await loadStore();
            const competingKey = 'synthetic-competing-key';
            if (!commits) {
                read.result = {
                    ...saved,
                    tmdb: { ...saved.tmdb, apiKey: competingKey },
                };
                storedSettings = read.result;
            }
            const opened = waitForOpen();
            const writing = store.saveTransferredTmdbKey(
                apiKey,
                saved.tmdb.apiKey.trim(),
                () => true
            );
            await opened;
            open.onsuccess?.();
            read.onsuccess?.();
            transaction.oncomplete?.();
            await expect(writing).resolves.toBe(commits);
            expect(put).toHaveBeenCalledTimes(commits ? 1 : 0);
            expect(store.tmdb?.()?.apiKey).toBe(
                commits ? apiKey : competingKey
            );
        }
    );

    it('preserves unrelated settings', async () => {
        const writing = transfer(apiKey, 'synthetic-old-key', () => true);
        open.onsuccess?.();
        read.onsuccess?.();
        expect(begin).toHaveBeenCalledWith('settings', 'readwrite');
        expect(put).toHaveBeenCalledWith(
            { ...saved, tmdb: { enabled: false, apiKey } },
            STORE_KEY.Settings
        );
        transaction.oncomplete?.();
        await expect(writing).resolves.toBe(true);
    });

    it.each([
        ['synthetic-old-key', false],
        ['stale-key', true],
    ])(
        'leaves the stored key untouched when comparison or session validation fails',
        async (expectedKey, isCurrent) => {
            const writing = transfer(apiKey, expectedKey, () => isCurrent);
            open.onsuccess?.();
            read.onsuccess?.();
            transaction.oncomplete?.();
            await expect(writing).resolves.toBe(false);
            expect(put).not.toHaveBeenCalled();
        }
    );

    it('rejects an aborted write without changing the running settings', async () => {
        read.result = undefined;
        const writing = transfer(apiKey, '', () => true);
        open.onsuccess?.();
        read.onsuccess?.();
        expect(put).toHaveBeenCalledWith(
            { tmdb: { enabled: false, apiKey } },
            STORE_KEY.Settings
        );
        transaction.onabort?.();
        await expect(writing).rejects.toThrow('Could not save');
    });

    it('does not create a replacement database when the settings store disappears', async () => {
        const writing = transfer(apiKey, '', () => true);
        open.onupgradeneeded?.();
        expect(abortUpgrade).toHaveBeenCalled();
        open.onerror?.();
        await expect(writing).rejects.toThrow('Could not save');
    });
    it('reports a missing settings object store without changing the running key', async () => {
        begin.mockImplementationOnce(() => {
            throw new Error('synthetic missing store');
        });
        const writing = transfer(apiKey, '', () => true);
        open.onsuccess?.();
        await expect(writing).rejects.toThrow('Could not save');
    });
});
