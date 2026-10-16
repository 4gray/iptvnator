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

describe('WorkspaceCommandPaletteComponent - Turkish case folding', () => {
    const turkishCommands: WorkspaceResolvedCommandItem[] = [
        {
            id: 'open-downloads',
            label: 'İndirilenleri aç',
            description: '',
            group: 'global',
            icon: 'download',
            keywords: [],
            priority: 50,
            visible: true,
            enabled: true,
            run: () => undefined,
        },
        {
            id: 'open-settings',
            label: 'Ayarlar',
            description: '',
            group: 'global',
            icon: 'settings',
            keywords: [],
            priority: 40,
            visible: true,
            enabled: true,
            run: () => undefined,
        },
    ];

    function setup(query: string): WorkspaceCommandPaletteComponent {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [WorkspaceCommandPaletteComponent],
            providers: [
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: { query, commands: turkishCommands },
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
        return fixture.componentInstance;
    }

    it.each(['indir', 'İndir', 'İNDİR'])(
        'finds a command whose label carries the dotted capital İ for the query %s (issue #609)',
        (query) => {
            expect(
                setup(query)
                    .flatCommands()
                    .map((command) => command.id)
            ).toEqual(['open-downloads']);
        }
    );
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

describe('WorkspaceCommandPaletteComponent - settings group', () => {
    function settingsCommand(
        id: string,
        label: string
    ): WorkspaceResolvedCommandItem {
        return {
            id: `settings:${id}`,
            label,
            description: 'Playback',
            group: 'settings',
            icon: 'play_circle',
            keywords: [],
            priority: 100,
            visible: true,
            enabled: true,
            run: () => undefined,
        };
    }

    const commands: WorkspaceResolvedCommandItem[] = [
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
        settingsCommand('video-player', 'Video player'),
        settingsCommand('theme', 'Theme'),
    ];

    function setup(options: {
        query: string;
        recentIds?: readonly string[];
        searchSettings?: jest.Mock;
    }) {
        const searchSettings =
            options.searchSettings ??
            jest.fn((query: string) =>
                query.includes('player') ? ['settings:video-player'] : []
            );

        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [WorkspaceCommandPaletteComponent],
            providers: [
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        query: options.query,
                        commands,
                        recentIds: options.recentIds ?? [],
                        searchSettings,
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
        return {
            component: fixture.componentInstance,
            fixture,
            searchSettings,
        };
    }

    it('keeps settings out of the list while the query is empty', () => {
        const { component, searchSettings } = setup({ query: '' });

        expect(component.flatCommands().map((command) => command.id)).toEqual([
            'open-settings',
        ]);
        expect(searchSettings).not.toHaveBeenCalled();
    });

    it('lists settings matches after the command groups, in search order', () => {
        const searchSettings = jest.fn(() => [
            'settings:theme',
            'settings:video-player',
        ]);
        const { component, fixture } = setup({
            query: 'settings',
            searchSettings,
        });

        const groups = component.commandGroups();
        expect(groups.map((group) => group.group)).toEqual([
            'global',
            'settings',
        ]);
        expect(groups[1].items.map((item) => item.id)).toEqual([
            'settings:theme',
            'settings:video-player',
        ]);
        expect(searchSettings).toHaveBeenLastCalledWith('settings');
        expect(fixture.nativeElement.textContent).toContain(
            'WORKSPACE.COMMAND_PALETTE.GROUP_SETTINGS'
        );
    });

    it('ranks settings only through the search callback, never by substring', () => {
        const { component } = setup({ query: 'theme' });

        // "Theme" contains the query, but the search callback decides.
        expect(component.flatCommands()).toEqual([]);

        component.query.set('player');
        expect(component.flatCommands().map((command) => command.id)).toEqual([
            'settings:video-player',
        ]);
    });

    it('shows a recently opened setting in the recent section', () => {
        const { component } = setup({
            query: '',
            recentIds: ['settings:theme'],
        });

        const [recent] = component.commandGroups();
        expect(recent.group).toBe('recent');
        expect(recent.items.map((item) => item.id)).toEqual(['settings:theme']);
    });
});
