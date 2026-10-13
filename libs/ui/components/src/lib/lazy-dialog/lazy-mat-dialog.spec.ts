import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { LazyMatDialog } from './lazy-mat-dialog';

describe('LazyMatDialog', () => {
    const dialog = { open: jest.fn() };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [{ provide: MatDialog, useValue: dialog }],
        });
    });

    it('resolves the root MatDialog from the dialog chunk once', async () => {
        const service = TestBed.inject(LazyMatDialog);
        const load = jest.spyOn(service, 'loadDialogModule');

        await expect(service.resolve()).resolves.toBe(dialog);
        await expect(service.resolve()).resolves.toBe(dialog);

        expect(load).toHaveBeenCalledTimes(1);
    });

    it('retries the chunk load after a failure instead of caching it', async () => {
        const service = TestBed.inject(LazyMatDialog);
        const original = service.loadDialogModule;
        service.loadDialogModule = jest
            .fn()
            .mockRejectedValueOnce(new Error('chunk failed'))
            .mockImplementation(original);

        await expect(service.resolve()).rejects.toThrow('chunk failed');
        await expect(service.resolve()).resolves.toBe(dialog);

        expect(service.loadDialogModule).toHaveBeenCalledTimes(2);
    });
});
