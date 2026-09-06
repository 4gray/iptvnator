import { CdkTrapFocus } from '@angular/cdk/a11y';
import { Component, Directive, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { EmbeddedMpvOverlayVisibilityService } from '@iptvnator/ui/playback';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import {
    WorkspaceShellContextDrawerService,
    WorkspacePortalContext,
    WorkspaceShellContextPanel,
} from '@iptvnator/workspace/shell/util';
import { WorkspaceShellComponent } from './workspace-shell.component';
import {
    WorkspaceHeaderBulkAction,
    WorkspaceShellFacade,
} from './services/workspace-shell.facade';
import { WorkspaceKeyboardShortcutsService } from '../workspace-keyboard-shortcuts/workspace-keyboard-shortcuts.service';

@Component({
    selector: 'app-workspace-shell-rail',
    template: '',
    standalone: true,
})
class MockWorkspaceShellRailComponent {
    readonly isMacOS = input(false);
    readonly brandLink = input('/workspace/dashboard');
    readonly brandTooltipKey = input('WORKSPACE.SHELL.RAIL_DASHBOARD');
    readonly brandAriaLabelKey = input('WORKSPACE.SHELL.OPEN_DASHBOARD');
    readonly workspaceLinks = input<unknown[]>([]);
    readonly primaryContextLinks = input<unknown[]>([]);
    readonly secondaryContextLinks = input<unknown[]>([]);
    readonly selectedSection = input<string | null>(null);
    readonly railProviderClass = input('');
    readonly isSettingsRoute = input(false);
}

@Component({
    selector: 'app-workspace-shell-header',
    template: '',
    standalone: true,
})
class MockWorkspaceShellHeaderComponent {
    readonly playlistTitle = input('');
    readonly playlistSubtitle = input('');
    readonly canOpenPlaylistInfo = input(false);
    readonly canOpenAccountInfo = input(false);
    readonly searchQuery = input('');
    readonly canUseSearch = input(false);
    readonly searchPlaceholder = input('');
    readonly searchScopeLabel = input('');
    readonly searchStatusLabel = input('');
    readonly headerShortcut = input<unknown>(null);
    readonly canRefreshPlaylist = input(false);
    readonly isRefreshingPlaylist = input(false);
    readonly isElectron = input(false);
    readonly hasNoPlaylists = input(false);
    readonly isDownloadsView = input(false);
    readonly activeDownloadsCount = input(0);
    readonly isSettingsRoute = input(false);
    readonly showContextDrawerToggle = input(false);
    readonly isContextDrawerOpen = input(false);
    readonly contextDrawerToggleAriaKey = input('');
    readonly contextDrawerTooltipKey = input('');
    readonly headerBulkAction = input<WorkspaceHeaderBulkAction | null>(null);
    readonly headerSidebarToggle = input<unknown>(null);
    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly shortcutsRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();
    readonly downloadsRequested = output<void>();
    readonly headerBulkActionRequested = output<void>();
    readonly headerSidebarToggleRequested = output<void>();
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
    readonly contextDrawerToggleRequested = output<void>();

    focusSearchInput = jest.fn();
    containsSearchInput = jest.fn(() => false);
    focusContextDrawerToggle = jest.fn(() => true);
}

@Component({
    selector: 'app-workspace-shell-context-sidebar',
    template: '',
    standalone: true,
})
class MockWorkspaceShellContextSidebarComponent {
    readonly variant = input<WorkspaceShellContextPanel>('none');
    readonly context = input<WorkspacePortalContext | null>(null);
    readonly section = input<string | null>(null);
    readonly hasPlaylists = input(false);
}

@Component({
    selector: 'app-external-playback-dock',
    template: '',
    standalone: true,
})
class MockExternalPlaybackDockComponent {
    readonly session = input<unknown>(null);
    readonly closeClicked = output<void>();
    readonly dismissClicked = output<void>();
}

@Component({
    selector: 'app-playlist-drop-overlay',
    template: '',
    standalone: true,
})
class MockPlaylistDropOverlayComponent {
    readonly state = input<unknown>({ kind: 'idle' });
}

@Directive({
    selector: '[appPlaylistDropZone]',
    exportAs: 'playlistDropZone',
    standalone: true,
})
class MockPlaylistDropZoneDirective {
    readonly overlayState = signal({ kind: 'idle' });
}

@Component({
    selector: 'app-workspace-shell-import-overlay',
    template: '',
    standalone: true,
})
class MockWorkspaceShellImportOverlayComponent {}

class MockWorkspaceKeyboardShortcutsService {
    openShortcutsDialog = jest.fn();
}

class MockWorkspaceShellFacade {
    readonly brandLink = signal('/workspace/dashboard');
    readonly brandTooltipKey = signal('WORKSPACE.SHELL.RAIL_DASHBOARD');
    readonly brandAriaLabelKey = signal('WORKSPACE.SHELL.OPEN_DASHBOARD');
    readonly workspaceLinks = signal([]);
    readonly primaryContextLinks = signal([]);
    readonly secondaryContextLinks = signal([]);
    readonly currentSection = signal<string | null>(null);
    readonly railProviderClass = signal('rail-context-region');
    readonly isSettingsRoute = signal(false);
    readonly playlistTitle = signal('Playlist A');
    readonly playlistSubtitle = signal('Subtitle');
    readonly canOpenPlaylistInfo = signal(true);
    readonly canOpenAccountInfo = signal(true);
    readonly searchQuery = signal('');
    readonly canUseSearch = signal(true);
    readonly searchPlaceholder = signal(
        'WORKSPACE.SHELL.SEARCH_PLAYLIST_PLACEHOLDER'
    );
    readonly searchScopeLabel = signal('Movies / All Items');
    readonly searchStatusLabel = signal('');
    readonly headerShortcut = signal(null);
    readonly canRefreshPlaylist = signal(false);
    readonly isRefreshingPlaylist = signal(false);
    readonly hasNoPlaylists = signal(false);
    readonly isDownloadsView = signal(false);
    readonly activeDownloadsCount = signal(3);
    readonly headerBulkAction = signal<WorkspaceHeaderBulkAction | null>(null);
    readonly headerSidebarToggle = signal(null);
    toggleLiveSidebar = jest.fn();
    readonly showContextPanel = signal(true);
    readonly hasContextPanelContent = signal(true);
    readonly contextDrawerLabelKeys = signal({
        aria: 'WORKSPACE.SHELL.CONTEXT_DRAWER_SETTINGS_TOGGLE',
        tooltip: 'WORKSPACE.SHELL.CONTEXT_DRAWER_SETTINGS_TOOLTIP',
    });
    readonly contextPanel = signal<WorkspaceShellContextPanel>('settings');
    readonly currentContext = signal<WorkspacePortalContext | null>(null);
    readonly showExternalPlaybackBar = signal(true);
    readonly externalPlaybackSession = signal({ id: 'session-1' });
    readonly showXtreamImportOverlay = signal(false);
    readonly xtreamImportCount = signal(0);
    readonly xtreamItemsToImport = signal(0);
    readonly xtreamActiveImportCount = signal(0);
    readonly xtreamActiveItemsToImport = signal(0);
    readonly xtreamImportTitleLabel = signal(
        'WORKSPACE.SHELL.XTREAM_IMPORT_TITLE'
    );
    readonly xtreamImportSourceLabel = signal(
        'WORKSPACE.SHELL.XTREAM_IMPORT_REMOTE_BADGE'
    );
    readonly xtreamImportPhaseLabel = signal(
        'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
    );
    readonly xtreamImportDetailLabel = signal(
        'WORKSPACE.SHELL.XTREAM_IMPORT_DETAIL_REMOTE'
    );
    readonly xtreamImportProgressLabel = signal('');
    readonly xtreamImportPhaseTone = signal<'remote' | 'local' | null>(
        'remote'
    );
    readonly canCancelXtreamImport = signal(false);
    readonly isCancellingXtreamImport = signal(false);
    readonly isMacOS = true;
    readonly isElectron = true;

    onSearchInput = jest.fn();
    onSearchEnter = jest.fn();
    openCommandPalette = jest.fn();
    openGlobalSearch = jest.fn();
    openAddPlaylistDialog = jest.fn();
    runHeaderShortcut = jest.fn();
    refreshCurrentPlaylist = jest.fn();
    openDownloadsShortcut = jest.fn();
    runHeaderBulkAction = jest.fn();
    openPlaylistInfo = jest.fn();
    openAccountInfo = jest.fn();
    openAccountInfoFor = jest.fn();
    closeActiveExternalSession = jest.fn();
    dismissActiveExternalSession = jest.fn();
    cancelXtreamImport = jest.fn();
}

describe('WorkspaceShellComponent', () => {
    it('creates and renders the shell composition with mocked children', async () => {
        const facade = new MockWorkspaceShellFacade();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        CdkTrapFocus,
                        RouterOutlet,
                        TranslatePipe,
                        MockExternalPlaybackDockComponent,
                        MockPlaylistDropOverlayComponent,
                        MockPlaylistDropZoneDirective,
                        MockWorkspaceShellContextSidebarComponent,
                        MockWorkspaceShellHeaderComponent,
                        MockWorkspaceShellImportOverlayComponent,
                        MockWorkspaceShellRailComponent,
                    ],
                    providers: [
                        {
                            provide: WorkspaceShellFacade,
                            useValue: facade,
                        },
                        {
                            provide: WorkspaceKeyboardShortcutsService,
                            useClass: MockWorkspaceKeyboardShortcutsService,
                        },
                        {
                            provide: EmbeddedMpvOverlayVisibilityService,
                            useValue: {
                                acquireExternalModalSurface: () => () =>
                                    undefined,
                            },
                        },
                        WorkspaceShellContextDrawerService,
                    ],
                },
            })
            .compileComponents();

        const fixture = TestBed.createComponent(WorkspaceShellComponent);
        fixture.detectChanges();

        expect(fixture.componentInstance).toBeTruthy();
        expect(
            fixture.nativeElement.querySelector('app-workspace-shell-rail')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-workspace-shell-header')
        ).not.toBeNull();
        const header = fixture.debugElement.query(
            By.directive(MockWorkspaceShellHeaderComponent)
        ).componentInstance as MockWorkspaceShellHeaderComponent;
        expect(header.activeDownloadsCount()).toBe(3);
        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-shell-context-sidebar'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-external-playback-dock')
        ).not.toBeNull();
        const externalDock = fixture.debugElement.query(
            By.directive(MockExternalPlaybackDockComponent)
        ).componentInstance as MockExternalPlaybackDockComponent;
        externalDock.dismissClicked.emit();
        expect(facade.dismissActiveExternalSession).toHaveBeenCalledTimes(1);
    });

    it('renders the xtream import overlay child only when the facade flag is true', async () => {
        const facade = new MockWorkspaceShellFacade();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        CdkTrapFocus,
                        RouterOutlet,
                        TranslatePipe,
                        MockExternalPlaybackDockComponent,
                        MockPlaylistDropOverlayComponent,
                        MockPlaylistDropZoneDirective,
                        MockWorkspaceShellContextSidebarComponent,
                        MockWorkspaceShellHeaderComponent,
                        MockWorkspaceShellImportOverlayComponent,
                        MockWorkspaceShellRailComponent,
                    ],
                    providers: [
                        {
                            provide: WorkspaceShellFacade,
                            useValue: facade,
                        },
                        {
                            provide: WorkspaceKeyboardShortcutsService,
                            useClass: MockWorkspaceKeyboardShortcutsService,
                        },
                        {
                            provide: EmbeddedMpvOverlayVisibilityService,
                            useValue: {
                                acquireExternalModalSurface: () => () =>
                                    undefined,
                            },
                        },
                        WorkspaceShellContextDrawerService,
                    ],
                },
            })
            .compileComponents();

        const fixture = TestBed.createComponent(WorkspaceShellComponent);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-shell-import-overlay'
            )
        ).toBeNull();

        facade.showXtreamImportOverlay.set(true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-shell-import-overlay'
            )
        ).not.toBeNull();
    });

    it('opens keyboard shortcuts when the header requests them', async () => {
        const facade = new MockWorkspaceShellFacade();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        CdkTrapFocus,
                        RouterOutlet,
                        TranslatePipe,
                        MockExternalPlaybackDockComponent,
                        MockPlaylistDropOverlayComponent,
                        MockPlaylistDropZoneDirective,
                        MockWorkspaceShellContextSidebarComponent,
                        MockWorkspaceShellHeaderComponent,
                        MockWorkspaceShellImportOverlayComponent,
                        MockWorkspaceShellRailComponent,
                    ],
                    providers: [
                        {
                            provide: WorkspaceShellFacade,
                            useValue: facade,
                        },
                        {
                            provide: WorkspaceKeyboardShortcutsService,
                            useClass: MockWorkspaceKeyboardShortcutsService,
                        },
                        {
                            provide: EmbeddedMpvOverlayVisibilityService,
                            useValue: {
                                acquireExternalModalSurface: () => () =>
                                    undefined,
                            },
                        },
                        WorkspaceShellContextDrawerService,
                    ],
                },
            })
            .compileComponents();

        const fixture = TestBed.createComponent(WorkspaceShellComponent);
        fixture.detectChanges();
        const shortcutsService = fixture.debugElement.injector.get(
            WorkspaceKeyboardShortcutsService
        ) as unknown as MockWorkspaceKeyboardShortcutsService;
        const header = fixture.debugElement.query(
            By.directive(MockWorkspaceShellHeaderComponent)
        ).componentInstance as MockWorkspaceShellHeaderComponent;

        header.shortcutsRequested.emit();

        expect(shortcutsService.openShortcutsDialog).toHaveBeenCalledTimes(1);
    });

    it('opens the routed global search and focuses header search on Ctrl/Cmd+F', async () => {
        jest.useFakeTimers();
        const facade = new MockWorkspaceShellFacade();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        CdkTrapFocus,
                        RouterOutlet,
                        TranslatePipe,
                        MockExternalPlaybackDockComponent,
                        MockPlaylistDropOverlayComponent,
                        MockPlaylistDropZoneDirective,
                        MockWorkspaceShellContextSidebarComponent,
                        MockWorkspaceShellHeaderComponent,
                        MockWorkspaceShellImportOverlayComponent,
                        MockWorkspaceShellRailComponent,
                    ],
                    providers: [
                        {
                            provide: WorkspaceShellFacade,
                            useValue: facade,
                        },
                        {
                            provide: WorkspaceKeyboardShortcutsService,
                            useClass: MockWorkspaceKeyboardShortcutsService,
                        },
                        {
                            provide: EmbeddedMpvOverlayVisibilityService,
                            useValue: {
                                acquireExternalModalSurface: () => () =>
                                    undefined,
                            },
                        },
                        WorkspaceShellContextDrawerService,
                    ],
                },
            })
            .compileComponents();

        const fixture = TestBed.createComponent(WorkspaceShellComponent);
        fixture.detectChanges();
        const header = fixture.debugElement.query(
            By.directive(MockWorkspaceShellHeaderComponent)
        ).componentInstance as MockWorkspaceShellHeaderComponent;
        const event = new KeyboardEvent('keydown', {
            key: 'f',
            metaKey: true,
            bubbles: true,
            cancelable: true,
        });

        document.dispatchEvent(event);
        jest.runOnlyPendingTimers();

        expect(event.defaultPrevented).toBe(true);
        expect(facade.openGlobalSearch).toHaveBeenCalledWith('');
        expect(header.focusSearchInput).toHaveBeenCalledWith({ select: true });
        jest.useRealTimers();
    });

    it('opens and closes the context drawer via the toggle, backdrop and Escape', async () => {
        jest.useFakeTimers();
        const facade = new MockWorkspaceShellFacade();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        CdkTrapFocus,
                        RouterOutlet,
                        TranslatePipe,
                        MockExternalPlaybackDockComponent,
                        MockPlaylistDropOverlayComponent,
                        MockPlaylistDropZoneDirective,
                        MockWorkspaceShellContextSidebarComponent,
                        MockWorkspaceShellHeaderComponent,
                        MockWorkspaceShellImportOverlayComponent,
                        MockWorkspaceShellRailComponent,
                    ],
                    providers: [
                        {
                            provide: WorkspaceShellFacade,
                            useValue: facade,
                        },
                        {
                            provide: WorkspaceKeyboardShortcutsService,
                            useClass: MockWorkspaceKeyboardShortcutsService,
                        },
                        {
                            provide: EmbeddedMpvOverlayVisibilityService,
                            useValue: {
                                acquireExternalModalSurface: () => () =>
                                    undefined,
                            },
                        },
                        WorkspaceShellContextDrawerService,
                    ],
                },
            })
            .compileComponents();

        const fixture = TestBed.createComponent(WorkspaceShellComponent);
        fixture.detectChanges();
        const sidebar = () =>
            fixture.nativeElement.querySelector(
                'app-workspace-shell-context-sidebar'
            ) as HTMLElement;
        const backdrop = () =>
            fixture.nativeElement.querySelector(
                '[data-test-id="context-drawer-backdrop"]'
            ) as HTMLElement | null;

        // Closed by default: no backdrop, no drawer-open class.
        expect(backdrop()).toBeNull();
        expect(sidebar().classList.contains('drawer-open')).toBe(false);

        const header = fixture.debugElement.query(
            By.directive(MockWorkspaceShellHeaderComponent)
        ).componentInstance as MockWorkspaceShellHeaderComponent;
        expect(header.showContextDrawerToggle()).toBe(true);

        header.contextDrawerToggleRequested.emit();
        fixture.detectChanges();
        expect(sidebar().classList.contains('drawer-open')).toBe(true);
        expect(header.isContextDrawerOpen()).toBe(true);
        // Assistive technology must hear a named modal surface open —
        // dialog semantics exist only while the drawer is open.
        expect(sidebar().getAttribute('role')).toBe('dialog');
        expect(sidebar().getAttribute('aria-modal')).toBe('true');
        expect(sidebar().getAttribute('aria-label')).toBe(
            'WORKSPACE.SHELL.CONTEXT_DRAWER_SETTINGS_TOOLTIP'
        );
        // The open drawer is modal: everything behind the backdrop leaves
        // the focus order and the accessibility tree via `inert`.
        expect(
            fixture.nativeElement
                .querySelector('.workspace-content')
                .hasAttribute('inert')
        ).toBe(true);
        expect(
            fixture.nativeElement
                .querySelector('app-workspace-shell-header')
                .hasAttribute('inert')
        ).toBe(true);
        expect(
            fixture.nativeElement
                .querySelector('app-workspace-shell-rail')
                .hasAttribute('inert')
        ).toBe(true);

        backdrop()?.click();
        fixture.detectChanges();
        expect(backdrop()).toBeNull();
        expect(sidebar().classList.contains('drawer-open')).toBe(false);
        // Closed again: back to a plain landmark, no dialog semantics.
        expect(sidebar().getAttribute('role')).toBeNull();
        expect(sidebar().getAttribute('aria-modal')).toBeNull();
        expect(
            fixture.nativeElement
                .querySelector('.workspace-content')
                .hasAttribute('inert')
        ).toBe(false);
        // Closing must hand focus back to the toggle: the closed drawer is
        // visibility: hidden, so focus left inside it would drop to <body>.
        // The restore is deferred past the render that un-inerts the header.
        jest.runOnlyPendingTimers();
        expect(header.focusContextDrawerToggle).toHaveBeenCalled();

        header.contextDrawerToggleRequested.emit();
        fixture.detectChanges();
        expect(sidebar().classList.contains('drawer-open')).toBe(true);

        const escapeWhileOpen = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(escapeWhileOpen);
        fixture.detectChanges();
        expect(sidebar().classList.contains('drawer-open')).toBe(false);
        // Consumed, so downstream Escape handlers (inline player close,
        // controls shortcuts) skip it — one keypress must not close both
        // the drawer and the obscured playback surface.
        expect(escapeWhileOpen.defaultPrevented).toBe(true);

        // With the drawer closed the shell must leave Escape alone.
        const escapeWhileClosed = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(escapeWhileClosed);
        expect(escapeWhileClosed.defaultPrevented).toBe(false);

        // Ctrl/Cmd+F must not navigate to global search while the drawer is
        // modal — it would act on the obscured, inert background.
        header.contextDrawerToggleRequested.emit();
        fixture.detectChanges();
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'f',
                metaKey: true,
                bubbles: true,
                cancelable: true,
            })
        );
        jest.runOnlyPendingTimers();
        expect(facade.openGlobalSearch).not.toHaveBeenCalled();

        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });
});
