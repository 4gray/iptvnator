import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { PwaUpdateService } from './pwa-update.service';

describe('PwaUpdateService', () => {
    let versions: Subject<VersionEvent>;
    let unrecoverable: Subject<unknown>;
    let action: Subject<void>;
    let open: jest.Mock;
    let check: jest.Mock;
    let enabled: boolean;
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        versions = new Subject();
        unrecoverable = new Subject();
        action = new Subject();
        enabled = true;
        open = jest
            .fn()
            .mockResolvedValue({ onAction: () => action, dismiss: jest.fn() });
        check = jest.fn().mockResolvedValue(false);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: SwUpdate,
                    useValue: {
                        get isEnabled() {
                            return enabled;
                        },
                        versionUpdates: versions,
                        unrecoverable,
                        checkForUpdate: check,
                    },
                },
                { provide: LazySnackBar, useValue: { open } },
                {
                    provide: TranslateService,
                    useValue: {
                        get: jest.fn((keys: string[]) =>
                            of(
                                Object.fromEntries(
                                    keys.map((key) => [key, key])
                                )
                            )
                        ),
                    },
                },
            ],
        });
    });

    afterEach(() => TestBed.resetTestingModule());

    function ready() {
        versions.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'a' },
            latestVersion: { hash: 'b' },
        });
    }

    it('does nothing in runtimes without a service worker', () => {
        enabled = false;
        TestBed.inject(PwaUpdateService);
        window.dispatchEvent(new Event('online'));
        expect(check).not.toHaveBeenCalled();
        expect(versions.observed).toBe(false);
    });

    it('does not announce discovery or an unchanged version as ready', () => {
        TestBed.inject(PwaUpdateService);
        versions.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
        versions.next({
            type: 'NO_NEW_VERSION_DETECTED',
            version: { hash: 'a' },
        });
        expect(open).not.toHaveBeenCalled();
    });

    it('waits for explicit Refresh and leaves native beforeunload protection intact', async () => {
        const service = TestBed.inject(PwaUpdateService);
        service.reloadWindow = jest.fn();
        ready();
        await flush();
        expect(open).toHaveBeenCalledWith('PWA_UPDATE_READY', 'REFRESH', {
            duration: 0,
        });
        expect(service.reloadWindow).not.toHaveBeenCalled();
        action.next();
        expect(service.reloadWindow).toHaveBeenCalledTimes(1);
    });

    it('waits for the dictionary before showing recovery copy', async () => {
        const labels = new Subject<Record<string, string>>();
        (TestBed.inject(TranslateService).get as jest.Mock).mockReturnValueOnce(
            labels
        );
        TestBed.inject(PwaUpdateService);
        ready();
        expect(open).not.toHaveBeenCalled();
        labels.next({ PWA_UPDATE_READY: 'Ready to reload', REFRESH: 'Reload' });
        labels.complete();
        await flush();
        expect(open).toHaveBeenCalledWith('Ready to reload', 'Reload', {
            duration: 0,
        });
    });

    it('offers Retry after failed installation and coalesces retry/online requests', async () => {
        TestBed.inject(PwaUpdateService);
        let finish!: (available: boolean) => void;
        check.mockReturnValue(
            new Promise<boolean>((resolve) => {
                finish = resolve;
            })
        );
        versions.next({
            type: 'VERSION_INSTALLATION_FAILED',
            version: { hash: 'b' },
            error: 'fixture unavailable',
        });
        await flush();
        expect(open).toHaveBeenCalledWith('PWA_UPDATE_FAILED', 'RETRY', {
            duration: 0,
        });
        action.next();
        window.dispatchEvent(new Event('online'));
        expect(check).toHaveBeenCalledTimes(1);
        finish(false);
        await flush();
        window.dispatchEvent(new Event('online'));
        expect(check).toHaveBeenCalledTimes(2);
    });

    it('reports a rejected check without exposing its raw error', async () => {
        TestBed.inject(PwaUpdateService);
        check.mockRejectedValue(
            new Error('synthetic internal transport error')
        );
        window.dispatchEvent(new Event('online'));
        await flush();
        expect(open).toHaveBeenCalledWith('PWA_UPDATE_FAILED', 'RETRY', {
            duration: 0,
        });
    });

    it('explains unavailable application files without claiming a new version is ready', async () => {
        const service = TestBed.inject(PwaUpdateService);
        service.reloadWindow = jest.fn();
        unrecoverable.next({ reason: 'fixture cache missing' });
        await flush();
        expect(open).toHaveBeenCalledWith('PWA_RELOAD_REQUIRED', 'REFRESH', {
            duration: 0,
        });
        expect(service.reloadWindow).not.toHaveBeenCalled();
    });

    it('retires a notice whose lazy snackbar arrives after a newer failure', async () => {
        TestBed.inject(PwaUpdateService);
        let finish!: (ref: unknown) => void;
        open.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        ready();
        await Promise.resolve();
        versions.next({
            type: 'VERSION_INSTALLATION_FAILED',
            version: { hash: 'b' },
            error: 'fixture',
        });
        const dismiss = jest.fn();
        finish({ dismiss, onAction: jest.fn() });
        await flush();
        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes from online and worker events on destruction', () => {
        TestBed.inject(PwaUpdateService);
        TestBed.resetTestingModule();
        window.dispatchEvent(new Event('online'));
        expect(check).not.toHaveBeenCalled();
        expect(versions.observed).toBe(false);
        expect(unrecoverable.observed).toBe(false);
    });
});
