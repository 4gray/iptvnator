import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { LazySnackBar } from '../lazy-snack-bar/lazy-snack-bar';
import {
    NOTIFICATION_DURATION_MS,
    NotificationService,
} from './notification.service';

@Component({ template: '' })
class ToastBodyComponent {}

describe('NotificationService', () => {
    let action$: Subject<void>;
    let lazySnackBar: { open: jest.Mock; resolve: jest.Mock };
    let snackBar: { openFromComponent: jest.Mock };
    let service: NotificationService;

    const flush = () => new Promise((resolve) => setTimeout(resolve));

    beforeEach(() => {
        action$ = new Subject<void>();
        snackBar = {
            openFromComponent: jest.fn().mockReturnValue({ id: 'ref' }),
        };
        lazySnackBar = {
            open: jest.fn().mockResolvedValue({
                onAction: () => action$.asObservable(),
            }),
            resolve: jest.fn().mockResolvedValue(snackBar),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: LazySnackBar, useValue: lazySnackBar },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string, params?: object) =>
                            params ? `${key} ${JSON.stringify(params)}` : key,
                    },
                },
            ],
        });
        service = TestBed.inject(NotificationService);
    });

    it('shows a success briefly, politely, without a button', () => {
        service.success('SAVED', { name: 'One' });

        expect(lazySnackBar.open).toHaveBeenCalledWith(
            'SAVED {"name":"One"}',
            undefined,
            {
                horizontalPosition: 'center',
                verticalPosition: 'bottom',
                politeness: 'polite',
                panelClass: ['app-notification', 'app-notification--success'],
                duration: NOTIFICATION_DURATION_MS.short,
            }
        );
    });

    it('shows info politely for the default duration', () => {
        service.info('STARTED');

        expect(lazySnackBar.open).toHaveBeenCalledWith(
            'STARTED',
            undefined,
            expect.objectContaining({
                politeness: 'polite',
                panelClass: ['app-notification', 'app-notification--info'],
                duration: NOTIFICATION_DURATION_MS.default,
            })
        );
    });

    it('announces an error assertively with a Close button', () => {
        service.error('FAILED');

        expect(lazySnackBar.open).toHaveBeenCalledWith(
            'FAILED',
            'CLOSE',
            expect.objectContaining({
                politeness: 'assertive',
                panelClass: ['app-notification', 'app-notification--error'],
                duration: NOTIFICATION_DURATION_MS.default,
            })
        );
    });

    it('keeps an error with an action until dismissed, with Close beside the action', async () => {
        const run = jest.fn();
        const actionRef = { onAction: () => action$.asObservable() };
        snackBar.openFromComponent.mockReturnValue(actionRef);
        service.loadActionToast = jest.fn(
            async () => ToastBodyComponent
        ) as never;

        service.error('FAILED', undefined, {
            action: { labelKey: 'RETRY', run },
        });
        await flush();

        expect(lazySnackBar.open).not.toHaveBeenCalled();
        expect(snackBar.openFromComponent).toHaveBeenCalledWith(
            ToastBodyComponent,
            expect.objectContaining({
                politeness: 'assertive',
                panelClass: ['app-notification', 'app-notification--error'],
                duration: undefined,
                data: {
                    message: 'FAILED',
                    actionLabel: 'RETRY',
                    closeLabel: 'CLOSE',
                },
            })
        );
        expect(run).not.toHaveBeenCalled();
        action$.next();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('drops a sticky action toast when a newer toast was requested while it loaded', async () => {
        let loaded!: (component: unknown) => void;
        service.loadActionToast = jest.fn(
            () => new Promise((resolve) => (loaded = resolve))
        ) as never;

        service.error('FAILED', undefined, {
            action: { labelKey: 'RETRY', run: jest.fn() },
        });
        await service.fromComponent(ToastBodyComponent, { data: 'undo' });
        loaded(ToastBodyComponent);
        await flush();

        expect(snackBar.openFromComponent).toHaveBeenCalledTimes(1);
        expect(snackBar.openFromComponent).toHaveBeenCalledWith(
            ToastBodyComponent,
            expect.objectContaining({ data: 'undo' })
        );
    });

    it('falls back to a timed text toast with the action when its chunk failed to load', async () => {
        const error = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const run = jest.fn();
        service.loadActionToast = jest.fn(async () => {
            throw new Error('chunk failed');
        });

        service.error('FAILED', undefined, {
            action: { labelKey: 'RETRY', run },
        });
        await flush();

        expect(error).toHaveBeenCalled();
        expect(snackBar.openFromComponent).not.toHaveBeenCalled();
        expect(lazySnackBar.open).toHaveBeenCalledWith(
            'FAILED',
            'RETRY',
            expect.objectContaining({
                politeness: 'assertive',
                duration: NOTIFICATION_DURATION_MS.default,
            })
        );
        action$.next();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('lets a caller pick another preset and lift the toast above a save bar', () => {
        service.info('UNDO_SWITCH', undefined, {
            duration: 'short',
            aboveSaveBar: true,
            action: { labelKey: 'UNDO', run: jest.fn() },
        });

        expect(lazySnackBar.open).toHaveBeenCalledWith(
            'UNDO_SWITCH',
            'UNDO',
            expect.objectContaining({
                duration: NOTIFICATION_DURATION_MS.short,
                panelClass: [
                    'app-notification',
                    'app-notification--info',
                    'app-notification--above-save-bar',
                ],
            })
        );
    });

    it('appends a bounded machine code and drops free provider text', () => {
        service.error('FETCH_FAILED', undefined, { code: 'ETIMEDOUT' });
        service.error('FETCH_FAILED', undefined, {
            code: 'https://user:secret@example.com failed',
        });
        service.error('FETCH_FAILED', undefined, {
            code: 'E' + 'X'.repeat(48),
        });

        expect(
            lazySnackBar.open.mock.calls.map(([message]) => message)
        ).toEqual(['FETCH_FAILED (ETIMEDOUT)', 'FETCH_FAILED', 'FETCH_FAILED']);
    });

    it('does not repeat a code the message already names', () => {
        TestBed.inject(TranslateService).instant = (key: string) =>
            key === 'FETCH_FAILED' ? 'Offline (ETIMEDOUT)' : key;

        service.error('FETCH_FAILED', undefined, { code: 'ETIMEDOUT' });

        expect(lazySnackBar.open).toHaveBeenCalledWith(
            'Offline (ETIMEDOUT)',
            'CLOSE',
            expect.anything()
        );
    });

    it('does not throw when the snack-bar chunk failed to load', async () => {
        lazySnackBar.open.mockResolvedValue(null);

        expect(() =>
            service.info('SWITCHED', undefined, {
                action: { labelKey: 'UNDO', run: jest.fn() },
            })
        ).not.toThrow();
        await flush();
    });

    it('opens a component toast with the shared config', async () => {
        await expect(
            service.fromComponent(ToastBodyComponent, {
                data: { message: 'Removed' },
                durationMs: 4000,
            })
        ).resolves.toEqual({ id: 'ref' });

        expect(snackBar.openFromComponent).toHaveBeenCalledWith(
            ToastBodyComponent,
            {
                horizontalPosition: 'center',
                verticalPosition: 'bottom',
                politeness: 'polite',
                panelClass: ['app-notification', 'app-notification--info'],
                data: { message: 'Removed' },
                duration: 4000,
            }
        );
    });

    it('gives a component toast the requested variant', async () => {
        await service.fromComponent(ToastBodyComponent, {
            data: null,
            variant: 'error',
        });

        expect(snackBar.openFromComponent).toHaveBeenCalledWith(
            ToastBodyComponent,
            expect.objectContaining({
                politeness: 'assertive',
                panelClass: ['app-notification', 'app-notification--error'],
            })
        );
    });

    it('settles a component toast with null after a failed chunk load', async () => {
        const error = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        lazySnackBar.resolve.mockRejectedValue(new Error('chunk failed'));

        await expect(
            service.fromComponent(ToastBodyComponent, { data: null })
        ).resolves.toBeNull();
        expect(error).toHaveBeenCalled();
    });
});
