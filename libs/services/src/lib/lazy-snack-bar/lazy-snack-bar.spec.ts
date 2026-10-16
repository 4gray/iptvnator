import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LazySnackBar } from './lazy-snack-bar';

describe('LazySnackBar', () => {
    const ref = { onAction: jest.fn() };
    let snackBar: { open: jest.Mock };

    beforeEach(() => {
        snackBar = { open: jest.fn(() => ref) };
        TestBed.configureTestingModule({
            providers: [{ provide: MatSnackBar, useValue: snackBar }],
        });
    });

    it('resolves the root MatSnackBar from the snack-bar chunk once', async () => {
        const service = TestBed.inject(LazySnackBar);
        const load = jest.spyOn(service, 'loadSnackBarModule');

        await expect(service.resolve()).resolves.toBe(snackBar);
        await expect(service.resolve()).resolves.toBe(snackBar);

        expect(load).toHaveBeenCalledTimes(1);
    });

    it('opens a text snack-bar with the same arguments and returns its ref', async () => {
        const service = TestBed.inject(LazySnackBar);

        await expect(
            service.open('Saved', 'Close', { duration: 2000 })
        ).resolves.toBe(ref);

        expect(snackBar.open).toHaveBeenCalledWith('Saved', 'Close', {
            duration: 2000,
        });
    });

    it('retries the chunk load after a failure instead of caching it', async () => {
        const service = TestBed.inject(LazySnackBar);
        const original = service.loadSnackBarModule;
        service.loadSnackBarModule = jest
            .fn()
            .mockRejectedValueOnce(new Error('chunk failed'))
            .mockImplementation(original);

        await expect(service.resolve()).rejects.toThrow('chunk failed');
        await expect(service.resolve()).resolves.toBe(snackBar);

        expect(service.loadSnackBarModule).toHaveBeenCalledTimes(2);
    });

    it('logs a failed chunk load from open and resolves to null', async () => {
        const error = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const service = TestBed.inject(LazySnackBar);
        service.loadSnackBarModule = jest
            .fn()
            .mockRejectedValue(new Error('chunk failed'));

        await expect(service.open('Saved')).resolves.toBeNull();

        expect(error).toHaveBeenCalledWith(
            'Could not open the snack-bar:',
            expect.any(Error)
        );
        expect(snackBar.open).not.toHaveBeenCalled();
    });
});
