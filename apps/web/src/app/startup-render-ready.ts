import { ApplicationRef } from '@angular/core';
import {
    Event as RouterEvent,
    NavigationCancel,
    NavigationEnd,
    NavigationError,
    NavigationSkipped,
    Router,
} from '@angular/router';
import { filter, firstValueFrom, mapTo, race, take, timer } from 'rxjs';

export const INITIAL_RENDER_READY_TIMEOUT_MS = 10000;
export const INITIAL_RENDER_CONTENT_TIMEOUT_MS = 10000;

export function isInitialNavigationSettled(event: RouterEvent): boolean {
    return (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError ||
        event instanceof NavigationSkipped
    );
}

export async function waitForInitialNavigationSettled(
    router: Router,
    timeoutMs = INITIAL_RENDER_READY_TIMEOUT_MS
): Promise<void> {
    await firstValueFrom(
        race(
            router.events.pipe(
                filter(isInitialNavigationSettled),
                take(1),
                mapTo(undefined)
            ),
            timer(timeoutMs).pipe(mapTo(undefined))
        )
    );
}

export function afterNextPaint(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    });
}

export function hasMeaningfulAppContent(documentRef: Document): boolean {
    const appRoot = documentRef.querySelector('app-root');
    if (!appRoot) {
        return false;
    }

    const meaningfulText = (appRoot.textContent ?? '').trim();
    if (meaningfulText.length > 0) {
        return true;
    }

    return Array.from(appRoot.querySelectorAll<HTMLElement>('*')).some(
        (element) => {
            if (element.tagName.toLowerCase() === 'router-outlet') {
                return false;
            }

            return Boolean(
                element.getAttribute('aria-label')?.trim() ||
                    element.getAttribute('title')?.trim() ||
                    element.getAttribute('data-testid')?.trim() ||
                    element.getAttribute('data-test-id')?.trim()
            );
        }
    );
}

export async function waitForMeaningfulAppContent(
    documentRef: Document,
    timeoutMs = INITIAL_RENDER_CONTENT_TIMEOUT_MS
): Promise<boolean> {
    if (hasMeaningfulAppContent(documentRef)) {
        return true;
    }

    if (timeoutMs <= 0) {
        return false;
    }

    const appRoot = documentRef.querySelector('app-root') ?? documentRef.body;
    if (typeof MutationObserver === 'undefined') {
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
        return hasMeaningfulAppContent(documentRef);
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            observer.disconnect();
            resolve(value);
        };
        const observer = new MutationObserver(() => {
            if (hasMeaningfulAppContent(documentRef)) {
                finish(true);
            }
        });
        const timeout = setTimeout(
            () => finish(hasMeaningfulAppContent(documentRef)),
            timeoutMs
        );

        observer.observe(appRoot, {
            attributes: true,
            childList: true,
            subtree: true,
        });
    });
}

export async function markAppRenderedWhenReady(
    appRef: ApplicationRef,
    options: {
        documentRef?: Document;
        timeoutMs?: number;
        windowRef?: Window;
    } = {}
): Promise<void> {
    const documentRef = options.documentRef ?? document;
    const windowRef = options.windowRef ?? window;
    const router = appRef.injector.get(Router);

    await waitForInitialNavigationSettled(router, options.timeoutMs);
    await afterNextPaint();
    const hasRenderedContent = await waitForMeaningfulAppContent(
        documentRef,
        options.timeoutMs ?? INITIAL_RENDER_CONTENT_TIMEOUT_MS
    );

    if (!hasRenderedContent) {
        documentRef.body.dataset.iptvnatorReady = 'false';
        documentRef.body.dataset.iptvnatorStartupError = 'blank-render';
        console.error(
            'IPTVnator startup blocked renderer-ready because app-root did not render meaningful content.'
        );
        return;
    }

    documentRef.getElementById('initial-splash')?.remove();
    documentRef.body.dataset.iptvnatorReady = 'true';
    windowRef.electron?.notifyRendererReady?.();
}
