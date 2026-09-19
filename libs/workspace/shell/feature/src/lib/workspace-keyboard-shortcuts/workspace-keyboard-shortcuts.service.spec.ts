import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { WorkspaceKeyboardShortcutsService } from './workspace-keyboard-shortcuts.service';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';

describe('WorkspaceKeyboardShortcutsService', () => {
    let afterClosed$: Subject<void>;
    let dialog: { open: jest.Mock };
    let runtime: { isElectron: boolean };
    let service: WorkspaceKeyboardShortcutsService;

    beforeEach(() => {
        afterClosed$ = new Subject<void>();
        dialog = {
            open: jest.fn().mockReturnValue({
                afterClosed: () => afterClosed$.asObservable(),
            }),
        };
        runtime = { isElectron: true };

        TestBed.configureTestingModule({
            providers: [
                WorkspaceKeyboardShortcutsService,
                { provide: MatDialog, useValue: dialog },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
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

        const dialogData = dialog.open.mock.calls[0][1].data;
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

        const dialogData = dialog.open.mock.calls[0][1].data;
        const itemIds = dialogData.groups.flatMap((group) =>
            group.items.map((item) => item.id)
        );

        expect(itemIds).toContain('open-global-search');
    });

    it('uses runtime capabilities for Electron-only shortcuts', () => {
        runtime.isElectron = false;

        service.openShortcutsDialog();

        const dialogData = dialog.open.mock.calls[0][1].data;
        const itemIds = dialogData.groups.flatMap((group) =>
            group.items.map((item) => item.id)
        );

        expect(itemIds).not.toContain('open-global-search');
    });
});
