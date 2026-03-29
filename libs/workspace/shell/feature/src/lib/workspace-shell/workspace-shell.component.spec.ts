import {
    Component,
    input,
    output,
    signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, provideRouter } from '@angular/router';
import {
    WorkspacePortalContext,
    WorkspaceShellContextPanel,
} from '@iptvnator/workspace/shell/util';
import { WorkspaceShellComponent } from './workspace-shell.component';
import {
    WorkspaceHeaderBulkAction,
    WorkspaceShellFacade,
} from './services/workspace-shell.facade';

@Component({
    selector: 'app-workspace-shell-rail',
    template: '',
    standalone: true,
})
class MockWorkspaceShellRailComponent {
    readonly isMacOS = input(false);
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
    readonly isGlobalFavoritesActive = input(false);
    readonly headerShortcut = input<unknown>(null);
    readonly isElectron = input(false);
    readonly isDownloadsView = input(false);
    readonly headerBulkAction = input<WorkspaceHeaderBulkAction | null>(null);
    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly globalFavoritesRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
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

class MockWorkspaceShellFacade {
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
    readonly isGlobalFavoritesRoute = signal(false);
    readonly isPortalFavoritesAllScope = signal(false);
    readonly headerShortcut = signal(null);
    readonly isDownloadsView = signal(false);
    readonly headerBulkAction = signal<WorkspaceHeaderBulkAction | null>(null);
    readonly showContextPanel = signal(true);
    readonly contextPanel = signal<WorkspaceShellContextPanel>('settings');
    readonly currentContext = signal<WorkspacePortalContext | null>(null);
    readonly showExternalPlaybackBar = signal(true);
    readonly externalPlaybackSession = signal({ id: 'session-1' });
    readonly showXtreamImportOverlay = signal(false);
    readonly xtreamImportCount = signal(0);
    readonly xtreamItemsToImport = signal(0);
    readonly isMacOS = true;
    readonly isElectron = true;

    onSearchInput = jest.fn();
    onSearchEnter = jest.fn();
    openCommandPalette = jest.fn();
    openAddPlaylistDialog = jest.fn();
    navigateToGlobalFavorites = jest.fn();
    runHeaderShortcut = jest.fn();
    openDownloadsShortcut = jest.fn();
    runHeaderBulkAction = jest.fn();
    openPlaylistInfo = jest.fn();
    openAccountInfo = jest.fn();
    closeActiveExternalSession = jest.fn();
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
                        MockWorkspaceShellContextSidebarComponent,
                        MockWorkspaceShellHeaderComponent,
                        MockWorkspaceShellRailComponent,
                    ],
                    providers: [
                        {
                            provide: WorkspaceShellFacade,
                            useValue: facade,
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
});
