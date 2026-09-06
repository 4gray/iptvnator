import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkspaceShellHeaderComponent } from './workspace-shell-header.component';

@Component({
    selector: 'app-playlist-switcher',
    template: '',
    standalone: true,
})
class MockPlaylistSwitcherComponent {
    readonly currentTitle = input.required<string>();
    readonly subtitle = input('');
    readonly showPlaylistInfo = input(false);
    readonly showAccountInfo = input(false);
    readonly showAddPlaylist = input(false);
    readonly canRefreshActivePlaylist = input(false);
    readonly isRefreshingActivePlaylist = input(false);
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();
}

describe('WorkspaceShellHeaderComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellHeaderComponent>;
    let component: WorkspaceShellHeaderComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WorkspaceShellHeaderComponent, NoopAnimationsModule],
            providers: [
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
        })
            .overrideComponent(WorkspaceShellHeaderComponent, {
                set: {
                    imports: [
                        MatIcon,
                        MatIconButton,
                        MatTooltip,
                        MockPlaylistSwitcherComponent,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WorkspaceShellHeaderComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('playlistTitle', 'Playlist A');
        fixture.componentRef.setInput('playlistSubtitle', 'Subtitle');
        fixture.componentRef.setInput('searchQuery', 'neo');
        fixture.componentRef.setInput('canUseSearch', true);
        fixture.componentRef.setInput(
            'searchPlaceholder',
            'WORKSPACE.SHELL.SEARCH_PLAYLIST_PLACEHOLDER'
        );
        fixture.detectChanges();
    });

    it('emits search input changes as user types', () => {
        const emitted: string[] = [];
        component.searchChanged.subscribe((value) => emitted.push(value));
        const input: HTMLInputElement = fixture.nativeElement.querySelector(
            'input[type="search"]'
        );

        input.value = 'matrix';
        input.dispatchEvent(new Event('input'));

        expect(emitted).toEqual(['matrix']);
    });

    it('focuses and selects the search input on request', () => {
        const input: HTMLInputElement = fixture.nativeElement.querySelector(
            'input[type="search"]'
        );
        input.value = 'matrix';
        input.blur();

        component.focusSearchInput({ select: true });

        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe('matrix'.length);
    });

    it('emits add playlist requests when the toolbar add button is clicked', () => {
        const requested = jest.fn();
        component.addPlaylistRequested.subscribe(requested);

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="WORKSPACE.SHELL.ADD_PLAYLIST"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('emits keyboard shortcuts requests from the help button', () => {
        const requested = jest.fn();
        component.shortcutsRequested.subscribe(requested);

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="WORKSPACE.SHORTCUTS.OPEN_ARIA"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('does not render the removed global favorites shortcut', () => {
        const button: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                'button[aria-label="WORKSPACE.SHELL.OPEN_GLOBAL_FAVORITES"]'
            );

        expect(button).toBeNull();
    });

    it('emits contextual header shortcut requests when configured', () => {
        const requested = jest.fn();
        component.headerShortcutRequested.subscribe(requested);
        fixture.componentRef.setInput('headerShortcut', {
            icon: 'tune',
            tooltipKey: 'shortcut.tooltip',
            ariaLabelKey: 'shortcut.aria',
            run: () => undefined,
        });
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="shortcut.aria"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('does not render the live rail toggle when the route has no rail', () => {
        expect(
            fixture.nativeElement.querySelector('.header-sidebar-toggle')
        ).toBeNull();
    });

    it('renders the live rail toggle in both rail states and emits toggle requests', () => {
        const requested = jest.fn();
        component.headerSidebarToggleRequested.subscribe(requested);
        fixture.componentRef.setInput('headerSidebarToggle', {
            expanded: true,
            tooltip: 'LAYOUT.TOGGLE_SIDEBAR_TOOLTIP',
            ariaLabel: 'LAYOUT.HIDE_CHANNELS_LIST',
        });
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            '.header-sidebar-toggle'
        );
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.getAttribute('aria-label')).toBe(
            'LAYOUT.HIDE_CHANNELS_LIST'
        );
        expect(button.classList).not.toContain(
            'header-sidebar-toggle--collapsed'
        );

        button.click();
        expect(requested).toHaveBeenCalledTimes(1);

        // The control stays in place once the rail is hidden; only its
        // pressed state, label and tint change.
        fixture.componentRef.setInput('headerSidebarToggle', {
            expanded: false,
            tooltip: 'LAYOUT.TOGGLE_SIDEBAR_TOOLTIP',
            ariaLabel: 'LAYOUT.SHOW_CHANNELS_LIST',
        });
        fixture.detectChanges();

        const collapsedButton: HTMLButtonElement =
            fixture.nativeElement.querySelector('.header-sidebar-toggle');
        expect(collapsedButton).toBe(button);
        expect(collapsedButton.getAttribute('aria-pressed')).toBe('false');
        expect(collapsedButton.getAttribute('aria-label')).toBe(
            'LAYOUT.SHOW_CHANNELS_LIST'
        );
        expect(collapsedButton.classList).toContain(
            'header-sidebar-toggle--collapsed'
        );
    });

    it('hides the live rail toggle on the settings route', () => {
        fixture.componentRef.setInput('headerSidebarToggle', {
            expanded: true,
            tooltip: 'tooltip',
            ariaLabel: 'aria',
        });
        fixture.componentRef.setInput('isSettingsRoute', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.header-sidebar-toggle')
        ).toBeNull();
    });

    it('renders scope and status chips when search metadata is provided', () => {
        fixture.componentRef.setInput('searchScopeLabel', 'Movies / All Items');
        fixture.componentRef.setInput(
            'searchStatusLabel',
            'Loaded channels only'
        );
        fixture.detectChanges();

        const chips = Array.from(
            fixture.nativeElement.querySelectorAll('.search-chip')
        ).map((element: Element) => element.textContent?.trim());

        expect(chips).toEqual(['Movies / All Items', 'Loaded channels only']);
    });

    it('renders the global active download count without duplicating the button name', () => {
        fixture.componentRef.setInput('isElectron', true);
        fixture.componentRef.setInput('activeDownloadsCount', 3);
        fixture.detectChanges();

        const badge: HTMLElement | null = fixture.nativeElement.querySelector(
            '[data-test-id="global-download-count"]'
        );

        expect(badge?.textContent?.trim()).toBe('3');
        expect(badge?.getAttribute('aria-hidden')).toBe('true');
        expect(
            fixture.nativeElement.querySelector('.download-activity-bar')
        ).not.toBeNull();
    });

    it('does not render a global download badge when no downloads are active', () => {
        fixture.componentRef.setInput('isElectron', true);
        fixture.componentRef.setInput('activeDownloadsCount', 0);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="global-download-count"]'
            )
        ).toBeNull();
    });

    it.each([
        [0, 'WORKSPACE.SHELL.OPEN_DOWNLOADS'],
        [1, 'WORKSPACE.SHELL.OPEN_DOWNLOADS (1)'],
        [3, 'WORKSPACE.SHELL.OPEN_DOWNLOADS (3)'],
    ])(
        'exposes %i active downloads in the downloads button accessible name',
        (activeDownloadsCount, expectedLabel) => {
            fixture.componentRef.setInput('isElectron', true);
            fixture.componentRef.setInput(
                'activeDownloadsCount',
                activeDownloadsCount
            );
            fixture.detectChanges();

            const button: HTMLButtonElement =
                fixture.nativeElement.querySelector(
                    '.download-btn-wrap button'
                );

            expect(button.getAttribute('aria-label')).toBe(expectedLabel);
        }
    );

    it('does not render the context drawer toggle by default', () => {
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="context-drawer-toggle"]'
            )
        ).toBeNull();
    });

    it('emits context drawer toggle requests when the route has a panel', () => {
        const requested = jest.fn();
        component.contextDrawerToggleRequested.subscribe(requested);
        fixture.componentRef.setInput('showContextDrawerToggle', true);
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            '[data-test-id="context-drawer-toggle"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('reflects the drawer state through aria-expanded', () => {
        fixture.componentRef.setInput('showContextDrawerToggle', true);
        fixture.componentRef.setInput('isContextDrawerOpen', true);
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            '[data-test-id="context-drawer-toggle"]'
        );

        expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('labels the drawer toggle from the variant-aware keys', () => {
        fixture.componentRef.setInput('showContextDrawerToggle', true);
        fixture.componentRef.setInput(
            'contextDrawerToggleAriaKey',
            'WORKSPACE.SHELL.CONTEXT_DRAWER_SETTINGS_TOGGLE'
        );
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            '[data-test-id="context-drawer-toggle"]'
        );

        expect(button.getAttribute('aria-label')).toBe(
            'WORKSPACE.SHELL.CONTEXT_DRAWER_SETTINGS_TOGGLE'
        );
    });

    it('focuses the drawer toggle on request', () => {
        fixture.componentRef.setInput('showContextDrawerToggle', true);
        fixture.detectChanges();

        component.focusContextDrawerToggle();

        expect(document.activeElement).toBe(
            fixture.nativeElement.querySelector(
                '[data-test-id="context-drawer-toggle"]'
            )
        );
    });

    it('uses the paired Material primary tokens for the download badge', () => {
        const styleSource = readFileSync(
            join(__dirname, 'workspace-shell-header.component.scss'),
            'utf8'
        );
        const badgeStyles = styleSource.match(
            /\.download-count-badge\s*\{([^}]*)\}/
        )?.[1];

        expect(badgeStyles).toContain('color: var(--mat-sys-on-primary);');
        expect(badgeStyles).toContain('background: var(--mat-sys-primary);');
    });
});
