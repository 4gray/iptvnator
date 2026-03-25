import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspaceCommandPaletteComponent } from './workspace-command-palette.component';

describe('WorkspaceCommandPaletteComponent', () => {
    let fixture: ComponentFixture<WorkspaceCommandPaletteComponent>;
    let component: WorkspaceCommandPaletteComponent;
    let dialogRef: { close: jest.Mock };

    beforeEach(async () => {
        dialogRef = {
            close: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [WorkspaceCommandPaletteComponent],
            providers: [
                {
                    provide: MatDialogRef,
                    useValue: dialogRef,
                },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        query: 'search',
                        commands: [
                            {
                                id: 'global-search',
                                label: 'Search all Xtream playlists',
                                description: 'Open global search overlay',
                                scope: 'global',
                                enabled: true,
                            },
                            {
                                id: 'playlist-search',
                                label: 'Search this playlist',
                                description: 'Open playlist search route',
                                scope: 'playlist',
                                enabled: true,
                            },
                        ],
                    },
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

        fixture = TestBed.createComponent(WorkspaceCommandPaletteComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('creates and applies initial query', () => {
        expect(component).toBeTruthy();
        expect(component.query()).toBe('search');
    });

    it('closes with selected command and query on click', () => {
        const command = component.flatCommands()[0];
        component.onCommandClick(command);

        expect(dialogRef.close).toHaveBeenCalledWith({
            commandId: 'global-search',
            query: 'search',
        });
    });
});
