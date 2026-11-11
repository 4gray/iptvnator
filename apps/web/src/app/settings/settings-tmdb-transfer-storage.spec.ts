import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { STORE_KEY } from '@iptvnator/shared/interfaces';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { SettingsTmdbTransferStorage } from './settings-tmdb-transfer-storage';

const apiKey = 'synthetic-received-key';
const saved = {
    showCaptions: false,
    tmdb: { enabled: false, apiKey: ' synthetic-old-key ' },
};

type Callback = () => void;

describe('TMDB key transfer storage', () => {
    let service: SettingsTmdbTransferStorage;
    let storage: {
        backingEngine: string;
        backingStore: { database: string; store: string };
        get: jest.Mock;
    };
    let applySavedTmdbKey: jest.Mock;
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

    beforeEach(() => {
        storage = {
            backingEngine: 'indexedDB',
            backingStore: { database: 'synthetic-db', store: 'settings' },
            get: jest.fn().mockReturnValue(of(saved)),
        };
        applySavedTmdbKey = jest.fn();
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
        originalIndexedDb = Object.getOwnPropertyDescriptor(
            globalThis,
            'indexedDB'
        );
        Object.defineProperty(globalThis, 'indexedDB', {
            configurable: true,
            value: { open: () => open },
        });
        TestBed.configureTestingModule({
            providers: [
                SettingsTmdbTransferStorage,
                { provide: StorageMap, useValue: storage },
                { provide: SettingsStore, useValue: { applySavedTmdbKey } },
            ],
        });
        service = TestBed.inject(SettingsTmdbTransferStorage);
    });

    afterEach(() => {
        if (originalIndexedDb)
            Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
    });

    it('reads the saved personal key and refuses memory-only storage', async () => {
        await expect(service.readSavedTmdbKey()).resolves.toBe(
            'synthetic-old-key'
        );
        expect(storage.get).toHaveBeenCalledWith(STORE_KEY.Settings);
        storage.get.mockReturnValue(of(undefined));
        await expect(service.readSavedTmdbKey()).resolves.toBe('');
        storage.backingEngine = 'memory';
        await expect(service.readSavedTmdbKey()).rejects.toThrow(
            'Local settings storage is unavailable'
        );
        await expect(
            service.saveTransferredTmdbKey(apiKey, '', () => true)
        ).rejects.toThrow('Could not save');
    });

    it('preserves unrelated settings and applies the key only when the transaction commits', async () => {
        const writing = service.saveTransferredTmdbKey(
            apiKey,
            'synthetic-old-key',
            () => true
        );
        open.onsuccess?.();
        read.onsuccess?.();
        expect(begin).toHaveBeenCalledWith('settings', 'readwrite');
        expect(put).toHaveBeenCalledWith(
            { ...saved, tmdb: { enabled: false, apiKey } },
            STORE_KEY.Settings
        );
        expect(applySavedTmdbKey).not.toHaveBeenCalled();
        transaction.oncomplete?.();
        await expect(writing).resolves.toBe(true);
        expect(applySavedTmdbKey).toHaveBeenCalledWith(apiKey);
    });

    it.each([
        ['synthetic-old-key', false],
        ['stale-key', true],
    ])(
        'leaves the stored key untouched when comparison or session validation fails',
        async (expectedKey, isCurrent) => {
            const writing = service.saveTransferredTmdbKey(
                apiKey,
                expectedKey,
                () => isCurrent
            );
            open.onsuccess?.();
            read.onsuccess?.();
            transaction.oncomplete?.();
            await expect(writing).resolves.toBe(false);
            expect(put).not.toHaveBeenCalled();
            expect(applySavedTmdbKey).not.toHaveBeenCalled();
        }
    );

    it('rejects an aborted write without changing the running settings', async () => {
        read.result = undefined;
        const writing = service.saveTransferredTmdbKey(apiKey, '', () => true);
        open.onsuccess?.();
        read.onsuccess?.();
        expect(put).toHaveBeenCalledWith(
            { tmdb: { enabled: false, apiKey } },
            STORE_KEY.Settings
        );
        transaction.onabort?.();
        await expect(writing).rejects.toThrow('Could not save');
        expect(applySavedTmdbKey).not.toHaveBeenCalled();
    });

    it('does not create a replacement database when the settings store disappears', async () => {
        const writing = service.saveTransferredTmdbKey(apiKey, '', () => true);
        open.onupgradeneeded?.();
        expect(abortUpgrade).toHaveBeenCalled();
        open.onerror?.();
        await expect(writing).rejects.toThrow('Could not save');
        expect(applySavedTmdbKey).not.toHaveBeenCalled();
    });
    it('reports a missing settings object store without changing the running key', async () => {
        begin.mockImplementationOnce(() => {
            throw new Error('synthetic missing store');
        });
        const writing = service.saveTransferredTmdbKey(apiKey, '', () => true);
        open.onsuccess?.();
        await expect(writing).rejects.toThrow('Could not save');
        expect(applySavedTmdbKey).not.toHaveBeenCalled();
    });
});
