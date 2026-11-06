import { TestBed } from '@angular/core/testing';
import {
    PARENTAL_LOCK_STORE_KEY,
    PARENTAL_LOCK_PIN_KEY,
} from '@iptvnator/shared/interfaces';
import { DatabaseService } from '../database-electron.service';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { ParentalLockStorageService } from './parental-lock-storage';
let mockProfilePrefix = '';
jest.mock('../source-sync/source-profile-storage', () => ({
    sourceProfileStorageKey: (key: string) => `${mockProfilePrefix}${key}`,
}));

describe('ParentalLockStorageService.readLocks', () => {
    const runtime = { supportsAppStateStorage: false };
    const databaseService = {
        readAppState: jest.fn<
            Promise<{ value: string | null } | null>,
            [string]
        >(),
    };
    let service: ParentalLockStorageService;

    beforeEach(() => {
        localStorage.clear();
        mockProfilePrefix = '';
        runtime.supportsAppStateStorage = false;
        databaseService.readAppState.mockReset();
        TestBed.configureTestingModule({
            providers: [
                ParentalLockStorageService,
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: DatabaseService, useValue: databaseService },
            ],
        });
        service = TestBed.inject(ParentalLockStorageService);
    });

    it('reads an absent store as empty', async () => {
        await expect(service.readLocks()).resolves.toEqual({});
    });
    it('adopts the previous browser PIN and locks before reading a source profile', async () => {
        mockProfilePrefix = 'iptvnator-server:nas:';
        const locks = { p: { xtream: [], stalker: [], m3u: ['Adult'] } };
        localStorage.setItem(PARENTAL_LOCK_PIN_KEY, 'existing-pin-hash');
        localStorage.setItem(PARENTAL_LOCK_STORE_KEY, JSON.stringify(locks));
        await expect(service.readPinHash()).resolves.toEqual({
            hash: 'existing-pin-hash',
        });
        await expect(service.readLocks()).resolves.toEqual(locks);
        expect(
            localStorage.getItem(`${mockProfilePrefix}${PARENTAL_LOCK_PIN_KEY}`)
        ).toBe('existing-pin-hash');
        await expect(service.writeLocks({})).resolves.toBe(true);
        await expect(service.readLocks()).resolves.toEqual({});
        expect(localStorage.getItem(PARENTAL_LOCK_STORE_KEY)).toBe(
            JSON.stringify(locks)
        );
    });
    it('keeps newer profile protection and fails closed on a partial migration', async () => {
        mockProfilePrefix = 'iptvnator-server:nas:';
        localStorage.setItem(PARENTAL_LOCK_PIN_KEY, 'old');
        localStorage.setItem(
            `${mockProfilePrefix}${PARENTAL_LOCK_PIN_KEY}`,
            'new'
        );
        await expect(service.readPinHash()).resolves.toEqual({ hash: 'new' });
        localStorage.clear();
        localStorage.setItem(PARENTAL_LOCK_PIN_KEY, 'old');
        const write = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });
        try {
            await expect(service.readPinHash()).resolves.toBeNull();
        } finally {
            write.mockRestore();
        }
        await expect(service.readPinHash()).resolves.toEqual({ hash: 'old' });
    });

    it('normalizes a stored store', async () => {
        localStorage.setItem(
            PARENTAL_LOCK_STORE_KEY,
            JSON.stringify({
                p: { xtream: [], stalker: [], m3u: ['Adult'], junk: 1 },
            })
        );
        await expect(service.readLocks()).resolves.toEqual({
            p: { xtream: [], stalker: [], m3u: ['Adult'] },
        });
    });

    it.each([
        ['truncated JSON', '{"p":{"m3u":["Adu'],
        ['an array payload', '[]'],
        ['a scalar payload', '"locks"'],
        [
            'a corrupt nested list',
            '{"p":{"xtream":"corrupt","stalker":[],"m3u":[]}}',
        ],
        [
            'a corrupt nested entry',
            '{"p":{"xtream":[],"stalker":[],"m3u":[1]}}',
        ],
        ['a playlist entry missing a list', '{"p":{}}'],
        [
            'an entry the normalizer would drop',
            '{"p":{"xtream":[{"categoryType":"live","xtreamId":"nope"}],"stalker":[],"m3u":[]}}',
        ],
    ])('treats %s as a failed read, not an empty store', async (_, raw) => {
        localStorage.setItem(PARENTAL_LOCK_STORE_KEY, raw);
        await expect(service.readLocks()).resolves.toBeNull();
    });

    it('treats a throwing localStorage as a failed read', async () => {
        const getItem = jest
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('SecurityError');
            });
        try {
            await expect(service.readLocks()).resolves.toBeNull();
        } finally {
            getItem.mockRestore();
        }
    });

    it('keeps an Electron read failure apart from a missing key', async () => {
        runtime.supportsAppStateStorage = true;
        databaseService.readAppState.mockResolvedValueOnce(null);
        await expect(service.readLocks()).resolves.toBeNull();

        databaseService.readAppState.mockResolvedValueOnce({ value: null });
        await expect(service.readLocks()).resolves.toEqual({});
    });
});
