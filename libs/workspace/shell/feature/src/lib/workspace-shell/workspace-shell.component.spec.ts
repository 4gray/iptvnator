import {
    Component,
    Directive,
    input,
    output,
    signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import {
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
    readonly hasActiveDownloads = input(false);
    readonly isSettingsRoute = input(false);
    readonly headerBulkAction = input<WorkspaceHeaderBulkAction | null>(null);
    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly shortcutsRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();
    readonly downloadsRequested = output<void>();
    readonly headerBulkActionRequested = output<void>();
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
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
    readonly hasActiveDownloads = signal(false);
    readonly headerBulkAction = signal<WorkspaceHeaderBulkAction | null>(null);
    readonly showContextPanel = signal(true);
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
    openAddPlaylistDialog = jest.fn();
    runHeaderShortcut = jest.fn();
    refreshCurrentPlaylist = jest.fn();
    openDownloadsShortcut = jest.fn();
    runHeaderBulkAction = jest.fn();
    openPlaylistInfo = jest.fn();
    openAccountInfo = jest.fn();
    closeActiveExternalSession = jest.fn();
    cancelXtreamImport = jest.fn();
}

describe('WorkspaceShellComponent', () => {
    it('creates and renders the shell composition with mocked children', async () => {
        const facade = new MockWorkspaceShellFacade();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellComponent],
            providers: [provideRouter([])],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        RouterOutlet,
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
        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-shell-context-sidebar'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-external-playback-dock')
        ).not.toBeNull();
    });

    it('renders the xtream import overlay child only when the facade flag is true', async () => {
        const facade = new MockWorkspaceShellFacade();

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellComponent],
            providers: [provideRouter([])],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        RouterOutlet,
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
            providers: [provideRouter([])],
        })
            .overrideComponent(WorkspaceShellComponent, {
                set: {
                    imports: [
                        RouterOutlet,
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
});
