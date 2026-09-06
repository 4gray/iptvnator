import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspaceResolvedCommandItem } from '@iptvnator/portal/shared/util';
import { WorkspaceCommandPaletteComponent } from './workspace-command-palette.component';

describe('WorkspaceCommandPaletteComponent', () => {
    let fixture: ComponentFixture<WorkspaceCommandPaletteComponent>;
    let component: WorkspaceCommandPaletteComponent;
    let dialogRef: { close: jest.Mock };
    let commands: WorkspaceResolvedCommandItem[];

    beforeEach(async () => {
        dialogRef = {
            close: jest.fn(),
        };
        commands = [
            {
                id: 'global-search',
                label: 'Search all Xtream playlists',
                description: 'Open global search overlay',
                group: 'global',
                icon: 'search',
                keywords: ['xtream', 'global'],
                priority: 100,
                visible: true,
                enabled: false,
                run: () => undefined,
            },
            {
                id: 'playlist-search',
                label: 'Search this playlist',
                description: 'Open playlist search route',
                group: 'playlist',
                icon: 'playlist_play',
                keywords: ['playlist'],
                priority: 10,
                visible: true,
                enabled: true,
                run: () => undefined,
            },
            {
                id: 'epg-guide',
                label: 'Open programme guide',
                description: '',
                group: 'view',
                icon: 'grid_view',
                keywords: ['epg', 'guide'],
                priority: 0,
                visible: true,
                enabled: true,
                run: () => undefined,
            },
            {
                id: 'hidden-command',
                label: 'Hidden command',
                description: 'Should not appear',
                group: 'global',
                icon: 'visibility_off',
                keywords: [],
                priority: 200,
                visible: false,
                enabled: true,
                run: () => undefined,
            },
        ];

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
                        commands,
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

    it('selects the first enabled command by default', () => {
        expect(component.selectedIndex()).toBe(0);
        expect(component.flatCommands()[0].id).toBe('playlist-search');
    });

    it('hides non-visible commands and omits empty groups', () => {
        expect(component.flatCommands().map((command) => command.id)).toEqual([
            'playlist-search',
            'global-search',
        ]);
        expect(component.commandGroups().map((group) => group.group)).toEqual([
            'playlist',
            'global',
        ]);
    });

    it('filters commands by keywords', () => {
        component.query.set('guide');

        expect(component.flatCommands().map((command) => command.id)).toEqual([
            'epg-guide',
        ]);
    });

    it('skips disabled commands during keyboard navigation', () => {
        component.query.set('');
        fixture.detectChanges();

        expect(component.flatCommands().map((command) => command.id)).toEqual([
            'epg-guide',
            'playlist-search',
            'global-search',
        ]);
        expect(component.selectedIndex()).toBe(0);

        component.onInputKeydown(
            new KeyboardEvent('keydown', { key: 'ArrowDown' })
        );
        expect(component.selectedIndex()).toBe(1);

        component.onInputKeydown(
            new KeyboardEvent('keydown', { key: 'ArrowDown' })
        );
        expect(component.selectedIndex()).toBe(0);
    });

    it('closes with selected command and query on click', () => {
        component.query.set('');
        const command = component.flatCommands()[0];
        component.onCommandClick(command);

        expect(dialogRef.close).toHaveBeenCalledWith({
            commandId: 'epg-guide',
            query: '',
        });
    });
});

describe('WorkspaceCommandPaletteComponent - recent section', () => {
    function setupComponent(options: {
        query: string;
        recentIds: readonly string[];
        commands?: WorkspaceResolvedCommandItem[];
    }): {
        component: WorkspaceCommandPaletteComponent;
        fixture: ComponentFixture<WorkspaceCommandPaletteComponent>;
    } {
        const baseCommands: WorkspaceResolvedCommandItem[] =
            options.commands ?? [
                {
                    id: 'open-settings',
                    label: 'Open settings',
                    description: '',
                    group: 'global',
                    icon: 'settings',
                    keywords: ['settings'],
                    priority: 50,
                    visible: true,
                    enabled: true,
                    run: () => undefined,
                },
                {
                    id: 'switch-player-mpv',
                    label: 'Switch player to MPV',
                    description: '',
                    group: 'global',
                    icon: 'play_circle',
                    keywords: ['mpv', 'player'],
                    priority: 93,
                    visible: true,
                    enabled: true,
                    run: () => undefined,
                },
                {
                    id: 'switch-player-vlc',
                    label: 'Switch player to VLC',
                    description: '',
                    group: 'global',
                    icon: 'play_circle',
                    keywords: ['vlc', 'player'],
                    priority: 94,
                    visible: true,
                    enabled: false,
                    run: () => undefined,
                },
            ];

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [WorkspaceCommandPaletteComponent],
            providers: [
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        query: options.query,
                        commands: baseCommands,
                        recentIds: options.recentIds,
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
        });

        const fixture = TestBed.createComponent(
            WorkspaceCommandPaletteComponent
        );
        fixture.detectChanges();

        return { component: fixture.componentInstance, fixture };
    }

    it('renders the recent section first when query is empty and ids resolve', () => {
        const { component } = setupComponent({
            query: '',
            recentIds: ['switch-player-mpv'],
        });

        const groups = component.commandGroups();
        expect(groups[0]?.group).toBe('recent');
        expect(groups[0]?.items.map((item) => item.id)).toEqual([
            'switch-player-mpv',
        ]);
    });

    it('omits recent ids from their native group to avoid duplicates', () => {
        const { component } = setupComponent({
            query: '',
            recentIds: ['switch-player-mpv'],
        });

        const flatIds = component.flatCommands().map((command) => command.id);
        const occurrences = flatIds.filter((id) => id === 'switch-player-mpv');
        expect(occurrences).toHaveLength(1);
    });

    it('hides the recent section once the user types', () => {
        const { component } = setupComponent({
            query: '',
            recentIds: ['switch-player-mpv'],
        });

        component.query.set('settings');

        expect(
            component.commandGroups().some((group) => group.group === 'recent')
        ).toBe(false);
    });

    it('drops recent ids that resolve to disabled or invisible commands', () => {
        const { component } = setupComponent({
            query: '',
            recentIds: ['switch-player-vlc', 'unknown-id'],
        });

        expect(
            component.commandGroups().some((group) => group.group === 'recent')
        ).toBe(false);
    });

    it('renders no recent section when recentIds is empty', () => {
        const { component } = setupComponent({
            query: '',
            recentIds: [],
        });

        expect(
            component.commandGroups().some((group) => group.group === 'recent')
        ).toBe(false);
    });
});
