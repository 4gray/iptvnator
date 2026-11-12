import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { STORE_KEY } from '@iptvnator/shared/interfaces';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { SettingsTmdbTransferStorage } from './settings-tmdb-transfer-storage';

describe('TMDB key transfer storage', () => {
    const storage = { backingEngine: 'indexedDB', get: jest.fn() };
    const saveTransferredTmdbKey = jest.fn();
    let service: SettingsTmdbTransferStorage;

    beforeEach(() => {
        storage.backingEngine = 'indexedDB';
        storage.get.mockReturnValue(
            of({ tmdb: { apiKey: ' synthetic-key ' } })
        );
        TestBed.configureTestingModule({
            providers: [
                SettingsTmdbTransferStorage,
                { provide: StorageMap, useValue: storage },
                {
                    provide: SettingsStore,
                    useValue: { saveTransferredTmdbKey },
                },
            ],
        });
        service = TestBed.inject(SettingsTmdbTransferStorage);
    });

    it('reads only the saved personal key and refuses memory-only storage', async () => {
        await expect(service.readSavedTmdbKey()).resolves.toBe('synthetic-key');
        expect(storage.get).toHaveBeenCalledWith(STORE_KEY.Settings);
        storage.get.mockReturnValue(of(undefined));
        await expect(service.readSavedTmdbKey()).resolves.toBe('');
        storage.backingEngine = 'memory';
        await expect(service.readSavedTmdbKey()).rejects.toThrow(
            'Local settings storage is unavailable'
        );
    });

    it('saves through the shared settings store', async () => {
        saveTransferredTmdbKey.mockResolvedValue(true);
        const isCurrent = () => true;
        await expect(
            service.saveTransferredTmdbKey('synthetic-received', '', isCurrent)
        ).resolves.toBe(true);
        expect(saveTransferredTmdbKey).toHaveBeenCalledWith(
            'synthetic-received',
            '',
            isCurrent
        );
    });
});
