import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspaceKeyboardShortcutsDialogComponent } from './workspace-keyboard-shortcuts-dialog.component';

describe('WorkspaceKeyboardShortcutsDialogComponent', () => {
    let fixture: ComponentFixture<WorkspaceKeyboardShortcutsDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WorkspaceKeyboardShortcutsDialogComponent],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        groups: [
                            {
                                id: 'global',
                                labelKey: 'WORKSPACE.SHORTCUTS.GROUPS.GLOBAL',
                                icon: 'keyboard',
                                items: [
                                    {
                                        id: 'open-command-palette',
                                        labelKey:
                                            'WORKSPACE.SHORTCUTS.ITEMS.OPEN_COMMAND_PALETTE',
                                        icon: 'terminal',
                                        chords: [
                                            {
                                                id: 'Cmd+K',
                                                ariaLabel: 'Command + K',
                                                keys: [
                                                    {
                                                        id: 'cmd',
                                                        label: 'Cmd',
                                                        ariaLabel: 'Command',
                                                        isModifier: true,
                                                    },
                                                    {
                                                        id: 'k',
                                                        label: 'K',
                                                        ariaLabel: 'K',
                                                        isModifier: false,
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                    {
                                        id: 'play-pause',
                                        labelKey:
                                            'WORKSPACE.SHORTCUTS.ITEMS.PLAY_PAUSE',
                                        icon: 'play_arrow',
                                        chords: [
                                            {
                                                id: 'Space',
                                                ariaLabel: 'Space',
                                                keys: [
                                                    {
                                                        id: 'space',
                                                        label: 'Space',
                                                        ariaLabel: 'Space',
                                                        isModifier: false,
                                                    },
                                                ],
                                            },
                                            {
                                                id: 'K',
                                                ariaLabel: 'K',
                                                keys: [
                                                    {
                                                        id: 'k',
                                                        label: 'K',
                                                        ariaLabel: 'K',
                                                        isModifier: false,
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                        platformIcon: 'laptop_mac',
                        platformLabelKey: 'WORKSPACE.SHORTCUTS.PLATFORM.MAC',
                    },
                },
                {
                    provide: MatDialogRef,
                    useValue: { close: jest.fn() },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(
            WorkspaceKeyboardShortcutsDialogComponent
        );
        fixture.detectChanges();
    });

    it('renders the dialog title and groups', () => {
        const text = fixture.nativeElement.textContent;

        expect(text).toContain('WORKSPACE.SHORTCUTS.TITLE');
        expect(text).toContain('WORKSPACE.SHORTCUTS.GROUPS.GLOBAL');
    });

    it('renders shortcut labels and multiple keys', () => {
        const text = fixture.nativeElement.textContent;

        expect(text).toContain(
            'WORKSPACE.SHORTCUTS.ITEMS.OPEN_COMMAND_PALETTE'
        );
        expect(text).toContain('WORKSPACE.SHORTCUTS.ITEMS.PLAY_PAUSE');
        expect(text).toContain('Cmd');
        expect(text).toContain('Space');
        expect(text).toContain('K');
    });

    it('renders the detected platform label', () => {
        expect(fixture.nativeElement.textContent).toContain(
            'WORKSPACE.SHORTCUTS.PLATFORM.MAC'
        );
    });
});
