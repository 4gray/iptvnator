import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkspaceBackNavigationService } from '@iptvnator/portal/shared/data-access';
import { WorkspaceBackTarget } from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import type { ElectronBridgeBackGestureSource } from '@iptvnator/shared/interfaces';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';
import {
    BACK_PRESS_TWIN_MS,
    WorkspaceBackGesturesService,
} from './workspace-back-gestures.service';

const MOUSE_BACK = 3;

describe('WorkspaceBackGesturesService', () => {
    const testWindow = window as unknown as {
        electron?: Record<string, unknown>;
    };
    const backTarget: WorkspaceBackTarget = {
        label: signal(null),
        escapeShortcut: signal(false),
        run: jest.fn(),
    };
    let target: ReturnType<typeof signal<WorkspaceBackTarget | null>>;
    let backNavigation: { target: typeof target; goBack: jest.Mock };
    let runtime: { supportsWindowBackGestures: boolean };
    let drawerOpen: boolean;
    let bridgeListener:
        ((source: ElectronBridgeBackGestureSource) => void) | null;
    let unsubscribeBridge: jest.Mock;
    let now: number;

    function setFullscreenElement(element: Element | null | undefined): void {
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            value: element,
        });
    }

    function createService(): WorkspaceBackGesturesService {
        TestBed.configureTestingModule({
            providers: [
                WorkspaceBackGesturesService,
                {
                    provide: WorkspaceBackNavigationService,
                    useValue: backNavigation,
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: WorkspaceShellContextDrawerService,
                    useValue: { isOpen: () => drawerOpen },
                },
            ],
        });
        return TestBed.inject(WorkspaceBackGesturesService);
    }

    function mouse(type: string, button = MOUSE_BACK): MouseEvent {
        const event = new MouseEvent(type, {
            button,
            bubbles: true,
            cancelable: true,
        });
        document.body.dispatchEvent(event);
        return event;
    }

    /** One mouse Back press; returns its mouseup and auxclick events. */
    function pressMouseBack(button = MOUSE_BACK): {
        mouseup: MouseEvent;
        auxclick: MouseEvent;
    } {
        mouse('mousedown', button);
        const mouseup = mouse('mouseup', button);
        const auxclick = mouse('auxclick', button);
        return { mouseup, auxclick };
    }

    function windowGesture(source: ElectronBridgeBackGestureSource): void {
        expect(bridgeListener).not.toBeNull();
        bridgeListener?.(source);
    }

    beforeEach(() => {
        target = signal<WorkspaceBackTarget | null>(backTarget);
        backNavigation = {
            target,
            goBack: jest.fn(() => target() !== null),
        };
        runtime = { supportsWindowBackGestures: true };
        drawerOpen = false;
        bridgeListener = null;
        unsubscribeBridge = jest.fn();
        testWindow.electron = {
            onWindowBackRequested: jest.fn(
                (
                    listener: (source: ElectronBridgeBackGestureSource) => void
                ) => {
                    bridgeListener = listener;
                    return unsubscribeBridge;
                }
            ),
        };
        now = 1_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        setFullscreenElement(null);
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        delete testWindow.electron;
        setFullscreenElement(null);
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    describe('mouse Back button', () => {
        it('runs Back and keeps the browser from its own history step', () => {
            createService();

            const { mouseup, auxclick } = pressMouseBack();

            expect(backNavigation.goBack).toHaveBeenCalledTimes(1);
            expect(mouseup.defaultPrevented).toBe(true);
            expect(auxclick.defaultPrevented).toBe(true);
        });

        it('leaves the press to the browser where there is no Back (PWA)', () => {
            target.set(null);
            runtime.supportsWindowBackGestures = false;
            createService();

            const { mouseup, auxclick } = pressMouseBack();

            expect(backNavigation.goBack).not.toHaveBeenCalled();
            expect(mouseup.defaultPrevented).toBe(false);
            expect(auxclick.defaultPrevented).toBe(false);
        });

        it('keeps the press from Chromium in Electron even without a Back', () => {
            // Chromium would traverse to an entry from before a reload,
            // which reloads the app.
            target.set(null);
            createService();

            const { mouseup, auxclick } = pressMouseBack();

            expect(backNavigation.goBack).not.toHaveBeenCalled();
            expect(mouseup.defaultPrevented).toBe(true);
            expect(auxclick.defaultPrevented).toBe(true);
        });

        it.each([0, 1, 2, 4])('ignores mouse button %i', (button) => {
            createService();

            const { mouseup } = pressMouseBack(button);

            expect(backNavigation.goBack).not.toHaveBeenCalled();
            expect(mouseup.defaultPrevented).toBe(false);
        });

        it('runs once per press, before handlers on the page', () => {
            createService();
            const pageListener = jest.fn((event: Event) =>
                event.stopPropagation()
            );
            document.body.addEventListener('mouseup', pageListener);

            pressMouseBack();
            pressMouseBack();

            expect(pageListener).toHaveBeenCalledTimes(2);
            expect(backNavigation.goBack).toHaveBeenCalledTimes(2);
            document.body.removeEventListener('mouseup', pageListener);
        });

        it('stops listening when the shell goes away', () => {
            createService();
            TestBed.resetTestingModule();

            pressMouseBack();

            expect(backNavigation.goBack).not.toHaveBeenCalled();
            expect(unsubscribeBridge).toHaveBeenCalledTimes(1);
        });
    });

    describe('blocked', () => {
        /** Nothing navigates, and the browser takes no step either. */
        function expectIgnored(service: WorkspaceBackGesturesService): void {
            expect(service.peek()).toBe('blocked');
            expect(service.goBack('keyboard')).toBe('blocked');
            windowGesture('swipe');
            windowGesture('app-command');
            expect(backNavigation.goBack).not.toHaveBeenCalled();

            // Swallowed in the PWA too: browser Back would navigate under
            // the dialog or out of the fullscreen player.
            TestBed.resetTestingModule();
            runtime.supportsWindowBackGestures = false;
            createService();
            const { mouseup, auxclick } = pressMouseBack();
            expect(mouseup.defaultPrevented).toBe(true);
            expect(auxclick.defaultPrevented).toBe(true);
            expect(backNavigation.goBack).not.toHaveBeenCalled();
        }

        it('while a player is fullscreen', () => {
            const service = createService();
            setFullscreenElement(document.createElement('video'));

            expectIgnored(service);
        });

        it('not where the Fullscreen API is missing', () => {
            // iPhone Safari has no unprefixed `document.fullscreenElement`.
            const service = createService();
            setFullscreenElement(undefined);

            expect(service.peek()).toBe('back');
            expect(service.goBack('keyboard')).toBe('back');
            expect(backNavigation.goBack).toHaveBeenCalledTimes(1);
        });

        it('while the phone context drawer is open', () => {
            const service = createService();
            drawerOpen = true;

            expectIgnored(service);
        });

        it.each(['dialog', 'alertdialog', 'menu'])(
            'while a %s is open',
            (role) => {
                const service = createService();
                const popup = document.createElement('div');
                popup.setAttribute('role', role);
                document.body.appendChild(popup);

                expectIgnored(service);
            }
        );

        it('while a CDK overlay backdrop shows', () => {
            const service = createService();
            const backdrop = document.createElement('div');
            backdrop.className =
                'cdk-overlay-backdrop cdk-overlay-backdrop-showing';
            document.body.appendChild(backdrop);

            expectIgnored(service);
        });

        it('not by hidden popups or a detaching backdrop', () => {
            const service = createService();
            const hidden = document.createElement('div');
            hidden.setAttribute('role', 'dialog');
            hidden.hidden = true;
            const ariaHidden = document.createElement('div');
            ariaHidden.setAttribute('aria-hidden', 'true');
            ariaHidden.innerHTML = '<div role="menu"></div>';
            const detaching = document.createElement('div');
            detaching.className = 'cdk-overlay-backdrop';
            const listbox = document.createElement('div');
            listbox.setAttribute('role', 'listbox');
            document.body.append(hidden, ariaHidden, detaching, listbox);

            expect(service.peek()).toBe('back');
            expect(service.goBack('keyboard')).toBe('back');
        });
    });

    describe('Electron window gestures', () => {
        it('runs Back for the swipe and the app command', () => {
            const service = createService();

            windowGesture('swipe');
            windowGesture('app-command');
            now += BACK_PRESS_TWIN_MS + 1;
            target.set(null);

            expect(backNavigation.goBack).toHaveBeenCalledTimes(2);
            expect(service.goBack('swipe')).toBe('none');
        });

        it('does not subscribe without the capability', () => {
            runtime.supportsWindowBackGestures = false;
            createService();

            expect(
                testWindow.electron?.['onWindowBackRequested']
            ).not.toHaveBeenCalled();
        });

        it('runs Back once when the command follows the release (Windows)', () => {
            createService();

            const { mouseup, auxclick } = pressMouseBack();
            now += 5;
            windowGesture('app-command');

            expect(backNavigation.goBack).toHaveBeenCalledTimes(1);
            expect(mouseup.defaultPrevented).toBe(true);
            expect(auxclick.defaultPrevented).toBe(true);
        });

        it('runs Back once when the command arrives while the button is down, however long it is held (Linux)', () => {
            createService();

            mouse('mousedown');
            windowGesture('app-command');
            expect(backNavigation.goBack).toHaveBeenCalledTimes(1);
            now += 2_000;
            const mouseup = mouse('mouseup');
            const auxclick = mouse('auxclick');

            expect(backNavigation.goBack).toHaveBeenCalledTimes(1);
            // The renderer half is spent, so the browser takes no step either.
            expect(mouseup.defaultPrevented).toBe(true);
            expect(auxclick.defaultPrevented).toBe(true);
        });

        it('runs Back once when the command arrives before the renderer sees the press', () => {
            createService();

            windowGesture('app-command');
            now += 5;
            mouse('mousedown');
            now += 2_000;
            const mouseup = mouse('mouseup');

            expect(backNavigation.goBack).toHaveBeenCalledTimes(1);
            expect(mouseup.defaultPrevented).toBe(true);
        });

        it('runs Back for each of two quick presses that both arrive twice', () => {
            createService();

            pressMouseBack();
            windowGesture('app-command');
            now += 120;
            mouse('mousedown');
            windowGesture('app-command');
            mouse('mouseup');

            expect(backNavigation.goBack).toHaveBeenCalledTimes(2);
        });

        it('treats a command after the pairing window as a new press', () => {
            createService();

            pressMouseBack();
            now += BACK_PRESS_TWIN_MS + 1;
            windowGesture('app-command');
            now += BACK_PRESS_TWIN_MS + 1;
            pressMouseBack();

            expect(backNavigation.goBack).toHaveBeenCalledTimes(3);
        });

        it('pairs only the mouse with the app command', () => {
            const service = createService();

            pressMouseBack();
            windowGesture('swipe');
            expect(service.goBack('keyboard')).toBe('back');

            expect(backNavigation.goBack).toHaveBeenCalledTimes(3);
        });

        it('spends no pairing on a press that did not run Back', () => {
            target.set(null);
            createService();

            pressMouseBack();
            target.set(backTarget);
            windowGesture('app-command');

            expect(backNavigation.goBack).toHaveBeenCalledTimes(1);
        });
    });
});
