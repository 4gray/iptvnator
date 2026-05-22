import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { WorkspaceKeyboardShortcutsService } from './workspace-keyboard-shortcuts.service';

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
