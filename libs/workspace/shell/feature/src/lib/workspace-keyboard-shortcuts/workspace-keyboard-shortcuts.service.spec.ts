import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { WorkspaceKeyboardShortcutsService } from './workspace-keyboard-shortcuts.service';

describe('WorkspaceKeyboardShortcutsService', () => {
    let afterClosed$: Subject<void>;
    let dialog: { open: jest.Mock };
    let service: WorkspaceKeyboardShortcutsService;

    beforeEach(() => {
        afterClosed$ = new Subject<void>();
        dialog = {
            open: jest.fn().mockReturnValue({
                afterClosed: () => afterClosed$.asObservable(),
            }),
        };

        TestBed.configureTestingModule({
            providers: [
                WorkspaceKeyboardShortcutsService,
                { provide: MatDialog, useValue: dialog },
            ],
        });

        service = TestBed.inject(WorkspaceKeyboardShortcutsService);
    });

    afterEach(() => {
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
});
