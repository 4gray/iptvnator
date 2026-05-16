import { ApplicationRef, Injector } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import {
    hasMeaningfulAppContent,
    markAppRenderedWhenReady,
} from './startup-render-ready';

describe('startup render readiness', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalElectron = window.electron;
    let routerEvents: Subject<unknown>;
    let notifyRendererReady: jest.Mock;

    beforeEach(() => {
        routerEvents = new Subject<unknown>();
        notifyRendererReady = jest.fn();
        document.body.innerHTML =
            '<div id="initial-splash"></div><app-root><main>IPTVnator</main></app-root>';
        document.body.removeAttribute('data-iptvnator-ready');
        global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                notifyRendererReady,
            },
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        global.requestAnimationFrame = originalRequestAnimationFrame;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: originalElectron,
        });
    });

    it('keeps the inline splash visible until the first router navigation settles', async () => {
        const appRef = createAppRefMock();
        const rendered = markAppRenderedWhenReady(appRef, {
            timeoutMs: 5000,
        });

        await Promise.resolve();

        expect(document.getElementById('initial-splash')).not.toBeNull();
        expect(document.body.dataset.iptvnatorReady).toBeUndefined();
        expect(notifyRendererReady).not.toHaveBeenCalled();

        routerEvents.next(new NavigationEnd(1, '/workspace', '/workspace'));
        await rendered;

        expect(document.getElementById('initial-splash')).toBeNull();
        expect(document.body.dataset.iptvnatorReady).toBe('true');
        expect(notifyRendererReady).toHaveBeenCalledTimes(1);
    });

    it('does not notify Electron when the first render is still blank', async () => {
        document.body.innerHTML =
            '<div id="initial-splash"></div><app-root><router-outlet></router-outlet></app-root>';
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const appRef = createAppRefMock();
        const rendered = markAppRenderedWhenReady(appRef, {
            timeoutMs: 0,
        });

        routerEvents.next(new NavigationEnd(1, '/workspace', '/workspace'));
        await rendered;

        expect(document.getElementById('initial-splash')).not.toBeNull();
        expect(document.body.dataset.iptvnatorReady).toBe('false');
        expect(document.body.dataset.iptvnatorStartupError).toBe(
            'blank-render'
        );
        expect(notifyRendererReady).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(
            'IPTVnator startup blocked renderer-ready because app-root did not render meaningful content.'
        );

        errorSpy.mockRestore();
    });

    it('treats rendered controls without text as meaningful content', () => {
        document.body.innerHTML =
            '<app-root><button data-testid="add-source"></button></app-root>';

        expect(hasMeaningfulAppContent(document)).toBe(true);
    });

    function createAppRefMock(): ApplicationRef {
        return {
            injector: {
                get: (token: unknown) => {
                    if (token === Router) {
                        return {
                            events: routerEvents.asObservable(),
                        };
                    }

                    throw new Error('Unexpected injection token');
                },
            } as Injector,
        } as ApplicationRef;
    }
});
