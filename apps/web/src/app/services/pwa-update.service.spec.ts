import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { PwaUpdateService } from './pwa-update.service';

describe('PwaUpdateService', () => {
    let versions: Subject<VersionEvent>;
    let unrecoverable: Subject<unknown>;
    let check: jest.Mock;
    let enabled: boolean;
    let worker: EventTarget & { controller: object | null };
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        versions = new Subject();
        unrecoverable = new Subject();
        enabled = true;
        check = jest.fn().mockResolvedValue(false);
        worker = Object.assign(new EventTarget(), { controller: null });
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: worker,
        });
        jest.spyOn(document, 'visibilityState', 'get').mockReturnValue(
            'visible'
        );
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
            ],
        });
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        Reflect.deleteProperty(navigator, 'serviceWorker');
        jest.restoreAllMocks();
    });

    function startWithControllerAfterInit() {
        const service = TestBed.inject(PwaUpdateService);
        worker.controller = {};
        return service;
    }

    function ready() {
        versions.next({
            type: 'VERSION_READY',
            currentVersion: { hash: 'a' },
            latestVersion: { hash: 'b' },
        });
    }
    function failed() {
        versions.next({
            type: 'VERSION_INSTALLATION_FAILED',
            version: { hash: 'c' },
            error: 'Synthetic transport failure',
        });
    }

    it('does nothing without a service worker or a pending action', () => {
        enabled = false;
        const service = TestBed.inject(PwaUpdateService);
        service.reloadWindow = jest.fn();
        service.act();
        window.dispatchEvent(new Event('online'));
        expect(check).not.toHaveBeenCalled();
        expect(versions.observed).toBe(false);
        expect(service.notice()).toBeNull();
        expect(service.reloadWindow).not.toHaveBeenCalled();
    });

    it('does not announce discovery or an unchanged version as ready', () => {
        const service = TestBed.inject(PwaUpdateService);
        versions.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
        versions.next({
            type: 'NO_NEW_VERSION_DETECTED',
            version: { hash: 'a' },
        });
        expect(service.notice()).toBeNull();
    });

    it('keeps Refresh reachable when reloading leaves the document alive', () => {
        const service = TestBed.inject(PwaUpdateService);
        service.reloadWindow = jest.fn();
        ready();
        expect(service.reloadWindow).not.toHaveBeenCalled();
        service.act();
        expect(service.notice()).toBe('ready');
        service.act();
        expect(service.reloadWindow).toHaveBeenCalledTimes(2);
    });

    it('coalesces retry/online requests and retains Retry for an eventless false result', async () => {
        const service = startWithControllerAfterInit();
        let finish!: (available: boolean) => void;
        check.mockReturnValue(
            new Promise<boolean>((resolve) => {
                finish = resolve;
            })
        );
        failed();
        service.act();
        window.dispatchEvent(new Event('online'));
        expect(check).toHaveBeenCalledTimes(1);
        expect(service.checking()).toBe(true);
        finish(false);
        await flush();
        expect(service.notice()).toBe('failed');
        expect(service.checking()).toBe(false);
        service.act();
        expect(check).toHaveBeenCalledTimes(2);
    });

    it('reports a rejected check without exposing its raw error', async () => {
        const service = startWithControllerAfterInit();
        check.mockRejectedValue(
            new Error('Synthetic internal transport error')
        );
        window.dispatchEvent(new Event('online'));
        await flush();
        expect(service.notice()).toBe('failed');
    });

    it('clears a recovered failure when a successful retry finds no update', async () => {
        const service = startWithControllerAfterInit();
        failed();
        expect(service.notice()).toBe('failed');
        check.mockImplementationOnce(async () => {
            versions.next({
                type: 'NO_NEW_VERSION_DETECTED',
                version: { hash: 'a' },
            });
            return false;
        });
        window.dispatchEvent(new Event('online'));
        await flush();
        expect(service.notice()).toBeNull();
        expect(service.noUpdate()).toBe(true);
    });

    it('announces a downloaded version even when VERSION_READY was missed', async () => {
        const service = startWithControllerAfterInit();
        check.mockResolvedValue(true);
        await service.check();
        expect(service.notice()).toBe('ready');
        expect(service.canReload()).toBe(true);
    });

    it('checks on startup when a worker already controls the page', async () => {
        worker.controller = {};
        TestBed.inject(PwaUpdateService);
        expect(check).toHaveBeenCalledTimes(1);
        await flush();
    });

    it('checks when control is available and when the page returns to the foreground', async () => {
        startWithControllerAfterInit();
        const visibility = jest.spyOn(document, 'visibilityState', 'get');
        visibility.mockReturnValue('hidden');
        worker.dispatchEvent(new Event('controllerchange'));
        document.dispatchEvent(new Event('visibilitychange'));
        expect(check).not.toHaveBeenCalled();

        visibility.mockReturnValue('visible');
        worker.dispatchEvent(new Event('controllerchange'));
        expect(check).toHaveBeenCalledTimes(1);
        await flush();
        document.dispatchEvent(new Event('visibilitychange'));
        expect(check).toHaveBeenCalledTimes(2);
        await flush();
    });

    it('reports an unavailable worker for manual checks without waiting for control', async () => {
        const service = TestBed.inject(PwaUpdateService);
        await service.check();
        expect(check).not.toHaveBeenCalled();
        expect(service.notice()).toBe('failed');
        expect(service.checking()).toBe(false);
    });

    it.each(['ready', 'unrecoverable'] as const)(
        'retains %s across later failures and no-update events',
        async (state) => {
            const service = startWithControllerAfterInit();
            service.reloadWindow = jest.fn();
            if (state === 'ready') ready();
            else
                unrecoverable.next({ reason: 'Synthetic missing cache entry' });
            window.dispatchEvent(new Event('online'));
            await flush();
            expect(service.notice()).toBe(state);
            failed();
            versions.next({
                type: 'NO_NEW_VERSION_DETECTED',
                version: { hash: 'b' },
            });
            expect(service.notice()).toBe(state);
            expect(service.reloadWindow).not.toHaveBeenCalled();
        }
    );

    it('unsubscribes from online and worker events on destruction', () => {
        startWithControllerAfterInit();
        TestBed.resetTestingModule();
        window.dispatchEvent(new Event('online'));
        document.dispatchEvent(new Event('visibilitychange'));
        worker.dispatchEvent(new Event('controllerchange'));
        expect(check).not.toHaveBeenCalled();
        expect(versions.observed).toBe(false);
        expect(unrecoverable.observed).toBe(false);
    });
});
