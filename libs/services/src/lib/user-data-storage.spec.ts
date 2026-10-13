import { TestBed } from '@angular/core/testing';
import { USER_DATA_STORAGE } from './user-data-storage';

describe('USER_DATA_STORAGE', () => {
    afterEach(() => {
        localStorage.clear();
        jest.restoreAllMocks();
        TestBed.resetTestingModule();
    });

    it('delegates to localStorage by default', () => {
        const storage = TestBed.inject(USER_DATA_STORAGE);

        storage.setItem('xtream-favorites', '{}');

        expect(localStorage.getItem('xtream-favorites')).toBe('{}');
        expect(storage.getItem('xtream-favorites')).toBe('{}');
        storage.removeItem('xtream-favorites');
        expect(localStorage.getItem('xtream-favorites')).toBeNull();
    });

    it('does not touch localStorage until a method is called', () => {
        // A browser that denies storage throws on the localStorage getter
        // itself; reading it only inside calls keeps that failure in the
        // callers' guarded reads instead of in service construction.
        const getter = jest.spyOn(globalThis, 'localStorage', 'get');

        const storage = TestBed.inject(USER_DATA_STORAGE);
        expect(getter).not.toHaveBeenCalled();

        storage.getItem('xtream-favorites');
        expect(getter).toHaveBeenCalledTimes(1);
    });
});
