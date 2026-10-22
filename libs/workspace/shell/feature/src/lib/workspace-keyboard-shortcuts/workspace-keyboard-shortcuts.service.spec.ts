import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { Observable, Subject } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { WorkspaceBackGesturesService } from '../workspace-back-gestures/workspace-back-gestures.service';
import { WorkspaceKeyboardShortcutsDialogData } from './workspace-keyboard-shortcuts-dialog.component';
import { WorkspaceKeyboardShortcutsService } from './workspace-keyboard-shortcuts.service';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';

describe('WorkspaceKeyboardShortcutsService', () => {
    let afterClosed$: Subject<void>;
    let dialog: {
        open: jest.Mock<
            { afterClosed: () => Observable<void> },
            [unknown, MatDialogConfig<WorkspaceKeyboardShortcutsDialogData>]
        >;
    };
    let runtime: { isElectron: boolean };
    let backGestures: { goBack: jest.Mock };
    let service: WorkspaceKeyboardShortcutsService;

    function openedDialogData(): WorkspaceKeyboardShortcutsDialogData {
        const data = dialog.open.mock.calls[0][1].data;
        if (!data) {
            throw new Error('Expected the shortcuts dialog to receive data');
        }
        return data;
    }

    beforeEach(() => {
        afterClosed$ = new Subject<void>();
        dialog = {
            open: jest.fn().mockReturnValue({
                afterClosed: () => afterClosed$.asObservable(),
            }),
        };
        runtime = { isElectron: true };
        backGestures = {
            goBack: jest.fn(() => 'back'),
        };

        TestBed.configureTestingModule({
            providers: [
                WorkspaceKeyboardShortcutsService,
                { provide: MatDialog, useValue: dialog },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: WorkspaceBackGesturesService,
                    useValue: backGestures,
                },
            ],
        });

        service = TestBed.inject(WorkspaceKeyboardShortcutsService);
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'userAgentData', {
            configurable: true,
            value: undefined,
        });
        TestBed.resetTestingModule();
    });

    it('opens the shortcuts dialog when question mark is pressed', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));

        expect(dialog.open).toHaveBeenCalledTimes(1);
    });

    it('opens the shortcuts dialog for Shift+/', () => {
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: '/', shiftKey: true })
        );

        expect(dialog.open).toHaveBeenCalledTimes(1);
    });

    it('does not open the dialog over the modal phone context drawer', () => {
        TestBed.resetTestingModule();
        const gatedDialog = { open: jest.fn() };
        TestBed.configureTestingModule({
            providers: [
                WorkspaceKeyboardShortcutsService,
                { provide: MatDialog, useValue: gatedDialog },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
                {
                    provide: WorkspaceShellContextDrawerService,
                    useValue: { isOpen: () => true },
                },
                {
                    provide: WorkspaceBackGesturesService,
                    useValue: backGestures,
                },
            ],
        });
        TestBed.inject(WorkspaceKeyboardShortcutsService);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));

        expect(gatedDialog.open).not.toHaveBeenCalled();
    });

    it('does not open while typing in an input', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);

        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: '?',
                bubbles: true,
            })
        );

        expect(dialog.open).not.toHaveBeenCalled();
        input.remove();
    });

    describe('Back chord', () => {
        function setPlatform(platform: string): void {
            Object.defineProperty(navigator, 'userAgentData', {
                configurable: true,
                value: { platform },
            });
        }

        function press(
            init: KeyboardEventInit,
            target: EventTarget = document.body
        ): KeyboardEvent {
            const event = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                ...init,
            });
            target.dispatchEvent(event);
            return event;
        }

        it('runs Back for Alt+ArrowLeft outside macOS and keeps the chord from the page and the browser', () => {
            setPlatform('Windows');
            const pageListener = jest.fn();
            document.body.addEventListener('keydown', pageListener);

            const event = press({ key: 'ArrowLeft', altKey: true });

            expect(backGestures.goBack).toHaveBeenCalledWith('keyboard');
            expect(event.defaultPrevented).toBe(true);
            // A focused carousel or player must not also read the arrow.
            expect(pageListener).not.toHaveBeenCalled();
            document.body.removeEventListener('keydown', pageListener);
        });

        it('runs Back for Cmd+[ on macOS only', () => {
            setPlatform('macOS');

            press({ key: 'ArrowLeft', altKey: true });
            expect(backGestures.goBack).not.toHaveBeenCalled();

            const event = press({
                key: '[',
                code: 'BracketLeft',
                metaKey: true,
            });
            expect(backGestures.goBack).toHaveBeenCalledWith('keyboard');
            expect(event.defaultPrevented).toBe(true);
        });

        it('swallows the chord without stopping it while something sits above the page', () => {
            setPlatform('Linux');
            backGestures.goBack.mockReturnValue('blocked');
            const dialogListener = jest.fn();
            document.body.addEventListener('keydown', dialogListener);

            const event = press({ key: 'ArrowLeft', altKey: true });

            expect(event.defaultPrevented).toBe(true);
            expect(dialogListener).toHaveBeenCalledTimes(1);
            document.body.removeEventListener('keydown', dialogListener);
        });

        it('leaves the chord to the page and the browser where there is no Back', () => {
            setPlatform('Linux');
            backGestures.goBack.mockReturnValue('none');
            const pageListener = jest.fn();
            document.body.addEventListener('keydown', pageListener);

            const event = press({ key: 'ArrowLeft', altKey: true });

            expect(backGestures.goBack).toHaveBeenCalledTimes(1);
            expect(event.defaultPrevented).toBe(false);
            expect(pageListener).toHaveBeenCalledTimes(1);
            document.body.removeEventListener('keydown', pageListener);
        });

        it('ignores the chord while typing', () => {
            setPlatform('Windows');
            const input = document.createElement('input');
            document.body.appendChild(input);

            const event = press({ key: 'ArrowLeft', altKey: true }, input);

            expect(backGestures.goBack).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
            input.remove();
        });

        it('runs Back once for a held chord and swallows its repeats until keyup', () => {
            setPlatform('Windows');
            const repeat = () =>
                press({ key: 'ArrowLeft', altKey: true, repeat: true });
            const pageListener = jest.fn();
            document.body.addEventListener('keydown', pageListener);

            press({ key: 'ArrowLeft', altKey: true });
            // Back reached the first in-app page: there is no Back left, but
            // the browser must still not take a step of its own.
            backGestures.goBack.mockReturnValue('none');
            const repeats = [repeat(), repeat()];

            expect(backGestures.goBack).toHaveBeenCalledTimes(1);
            expect(repeats.map((event) => event.defaultPrevented)).toEqual([
                true,
                true,
            ]);
            expect(pageListener).not.toHaveBeenCalled();

            document.dispatchEvent(
                new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true })
            );
            expect(repeat().defaultPrevented).toBe(false);
            document.body.removeEventListener('keydown', pageListener);
        });

        it('leaves the repeats of a chord that had no Back to the browser', () => {
            setPlatform('Windows');
            backGestures.goBack.mockReturnValue('none');

            press({ key: 'ArrowLeft', altKey: true });
            backGestures.goBack.mockReturnValue('back');
            const repeat = press({
                key: 'ArrowLeft',
                altKey: true,
                repeat: true,
            });

            expect(backGestures.goBack).toHaveBeenCalledTimes(1);
            expect(repeat.defaultPrevented).toBe(false);
        });

        it('keeps a blocked chord blocked while it is held', () => {
            setPlatform('Windows');
            backGestures.goBack.mockReturnValue('blocked');
            const dialogListener = jest.fn();
            document.body.addEventListener('keydown', dialogListener);

            press({ key: 'ArrowLeft', altKey: true });
            const repeat = press({
                key: 'ArrowLeft',
                altKey: true,
                repeat: true,
            });

            expect(backGestures.goBack).toHaveBeenCalledTimes(1);
            expect(repeat.defaultPrevented).toBe(true);
            expect(dialogListener).toHaveBeenCalledTimes(2);
            document.body.removeEventListener('keydown', dialogListener);
        });

        it('ignores other arrows, modifiers and a chord another handler consumed', () => {
            setPlatform('Windows');

            press({ key: 'ArrowLeft' });
            press({ key: 'ArrowRight', altKey: true });
            press({ key: 'ArrowLeft', altKey: true, ctrlKey: true });
            const consumed = new KeyboardEvent('keydown', {
                key: 'ArrowLeft',
                altKey: true,
                bubbles: true,
                cancelable: true,
            });
            consumed.preventDefault();
            document.body.dispatchEvent(consumed);

            expect(backGestures.goBack).not.toHaveBeenCalled();
            expect(dialog.open).not.toHaveBeenCalled();
        });
    });

    describe('F11 window fullscreen toggle', () => {
        const testWindow = window as unknown as {
            electron?: Record<string, unknown>;
        };
        let toggleFullScreenWindow: jest.Mock;

        function pressF11(
            init: KeyboardEventInit = {},
            target: EventTarget = document
        ): KeyboardEvent {
            const event = new KeyboardEvent('keydown', {
                key: 'F11',
                bubbles: true,
                cancelable: true,
                ...init,
            });
            target.dispatchEvent(event);
            return event;
        }

        function setHtmlFullscreenElement(element: Element | null): void {
            Object.defineProperty(document, 'fullscreenElement', {
                configurable: true,
                value: element,
            });
        }

        beforeEach(() => {
            toggleFullScreenWindow = jest.fn().mockResolvedValue({
                isMaximized: false,
                isFullScreen: true,
            });
            testWindow.electron = { toggleFullScreenWindow };
            setHtmlFullscreenElement(null);
        });

        afterEach(() => {
            delete testWindow.electron;
            setHtmlFullscreenElement(null);
        });

        it('toggles window fullscreen through the bridge and swallows the key', () => {
            const event = pressF11();

            expect(toggleFullScreenWindow).toHaveBeenCalledTimes(1);
            expect(event.defaultPrevented).toBe(true);
            expect(dialog.open).not.toHaveBeenCalled();
        });

        it('works while typing in an input — it is the exit from a fullscreen launch', () => {
            const input = document.createElement('input');
            document.body.appendChild(input);

            pressF11({}, input);

            expect(toggleFullScreenWindow).toHaveBeenCalledTimes(1);
            input.remove();
        });

        it('leaves the key alone while the player owns HTML fullscreen', () => {
            setHtmlFullscreenElement(document.createElement('div'));

            const event = pressF11();

            expect(toggleFullScreenWindow).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        it('ignores modified and auto-repeated F11 presses', () => {
            pressF11({ ctrlKey: true });
            pressF11({ metaKey: true });
            pressF11({ altKey: true });
            pressF11({ shiftKey: true });
            pressF11({ repeat: true });

            expect(toggleFullScreenWindow).not.toHaveBeenCalled();
        });

        it('leaves F11 to the browser without a bridge', () => {
            delete testWindow.electron;

            const event = pressF11();

            expect(event.defaultPrevented).toBe(false);
        });
    });

    describe('zoom shortcuts', () => {
        const testWindow = window as unknown as {
            electron?: Record<string, unknown>;
        };
        let adjustZoomLevel: jest.Mock;

        function press(
            init: KeyboardEventInit,
            target: EventTarget = document
        ): KeyboardEvent {
            const event = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                ...init,
            });
            target.dispatchEvent(event);
            return event;
        }

        beforeEach(() => {
            adjustZoomLevel = jest.fn().mockReturnValue(0.5);
            testWindow.electron = { adjustZoomLevel, platform: 'linux' };
        });

        afterEach(() => {
            delete testWindow.electron;
        });

        it('zooms in, out and resets through the bridge with Ctrl on Linux/Windows', () => {
            const zoomIn = press({ key: '=', ctrlKey: true });
            const zoomOut = press({ key: '-', ctrlKey: true });
            const reset = press({ key: '0', ctrlKey: true });

            expect(adjustZoomLevel.mock.calls).toEqual([
                ['in'],
                ['out'],
                ['reset'],
            ]);
            expect(zoomIn.defaultPrevented).toBe(true);
            expect(zoomOut.defaultPrevented).toBe(true);
            expect(reset.defaultPrevented).toBe(true);
            expect(dialog.open).not.toHaveBeenCalled();
        });

        it('takes the numpad keys and Ctrl+Shift+=', () => {
            press({ key: '+', code: 'NumpadAdd', ctrlKey: true });
            press({ key: '+', ctrlKey: true, shiftKey: true });

            expect(adjustZoomLevel.mock.calls).toEqual([['in'], ['in']]);
        });

        it('follows the bridge platform: Cmd on macOS, and swallows the key so the menu role cannot step twice', () => {
            testWindow.electron = { adjustZoomLevel, platform: 'darwin' };

            const ctrl = press({ key: '=', ctrlKey: true });
            const cmd = press({ key: '=', metaKey: true });

            expect(adjustZoomLevel.mock.calls).toEqual([['in']]);
            expect(ctrl.defaultPrevented).toBe(false);
            expect(cmd.defaultPrevented).toBe(true);
        });

        it('works while typing in an input, like the browser zoom it replaces', () => {
            const input = document.createElement('input');
            document.body.appendChild(input);

            press({ key: '=', ctrlKey: true }, input);

            expect(adjustZoomLevel).toHaveBeenCalledWith('in');
            input.remove();
        });

        it('leaves a key another handler already consumed alone', () => {
            const event = new KeyboardEvent('keydown', {
                key: '=',
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            });
            event.preventDefault();
            document.dispatchEvent(event);

            expect(adjustZoomLevel).not.toHaveBeenCalled();
        });

        it('ignores unrelated Ctrl combinations and unmodified keys', () => {
            press({ key: 'k', ctrlKey: true });
            press({ key: '=' });
            press({ key: '=', ctrlKey: true, altKey: true });

            expect(adjustZoomLevel).not.toHaveBeenCalled();
        });

        it('leaves zoom to the browser without a bridge', () => {
            delete testWindow.electron;

            const event = press({ key: '=', ctrlKey: true });

            expect(event.defaultPrevented).toBe(false);
        });

        it('swallows a bridge failure', () => {
            adjustZoomLevel.mockImplementation(() => {
                throw new Error('frame gone');
            });

            expect(() => press({ key: '=', ctrlKey: true })).not.toThrow();
        });
    });

    it('does not open duplicate dialogs while one is active', () => {
        service.openShortcutsDialog();
        service.openShortcutsDialog();

        expect(dialog.open).toHaveBeenCalledTimes(1);

        afterClosed$.next();
        service.openShortcutsDialog();

        expect(dialog.open).toHaveBeenCalledTimes(2);
    });

    it('uses userAgentData platform when resolving shortcut modifier labels', () => {
        Object.defineProperty(navigator, 'userAgentData', {
            configurable: true,
            value: { platform: 'Windows' },
        });

        service.openShortcutsDialog();

        const dialogData = openedDialogData();
        const commandPaletteShortcut = dialogData.groups
            .flatMap((group) => group.items)
            .find((item) => item.id === 'open-command-palette');

        expect(dialogData.platformLabelKey).toBe(
            'WORKSPACE.SHORTCUTS.PLATFORM.OTHER'
        );
        expect(commandPaletteShortcut?.chords[0].keys[0].label).toBe('Ctrl');
    });

    it('includes Electron-only shortcuts when runtime supports Electron', () => {
        service.openShortcutsDialog();

        const dialogData = openedDialogData();
        const itemIds = dialogData.groups.flatMap((group) =>
            group.items.map((item) => item.id)
        );

        expect(itemIds).toContain('open-global-search');
    });

    it('uses runtime capabilities for Electron-only shortcuts', () => {
        runtime.isElectron = false;

        service.openShortcutsDialog();

        const dialogData = openedDialogData();
        const itemIds = dialogData.groups.flatMap((group) =>
            group.items.map((item) => item.id)
        );

        expect(itemIds).not.toContain('open-global-search');
    });
});
