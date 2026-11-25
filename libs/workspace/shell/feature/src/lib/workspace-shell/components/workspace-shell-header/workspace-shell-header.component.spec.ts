import { PlaylistSwitcherComponent } from '@iptvnator/playlist/shared/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    Component,
    input,
    output,
    signal,
    ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    WorkspaceBackPhoneSlot,
    WorkspaceBackTarget,
} from '@iptvnator/portal/shared/util';
import { WorkspaceShellHeaderComponent } from './workspace-shell-header.component';

@Component({
    selector: 'app-playlist-switcher',
    template: '',
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: true,
})
class MockPlaylistSwitcherComponent {
    readonly currentTitle = input.required<string>();
    readonly subtitle = input('');
    readonly addPlaylistRequested = output<void>();
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
                remove: { imports: [PlaylistSwitcherComponent] },
                add: { imports: [MockPlaylistSwitcherComponent] },
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

    describe('search Enter', () => {
        const pressEnter = (init: KeyboardEventInit = {}) => {
            const submitted: string[] = [];
            component.searchSubmitted.subscribe((value) =>
                submitted.push(value)
            );
            const input: HTMLInputElement = fixture.nativeElement.querySelector(
                'input[type="search"]'
            );
            input.value = 'example query';
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    bubbles: true,
                    cancelable: true,
                    ...init,
                })
            );
            return submitted;
        };

        it('submits the typed search', () => {
            expect(pressEnter()).toEqual(['example query']);
        });

        it.each([
            ['isComposing', { isComposing: true }],
            ['keyCode 229 after compositionend', { keyCode: 229 }],
        ])(
            'does not submit an Enter that commits an IME composition (%s)',
            (_label, init) => {
                // Safari: the commit key follows compositionend with 229.
                if (!('isComposing' in init)) {
                    fixture.nativeElement
                        .querySelector('input')
                        .dispatchEvent(
                            new Event('compositionend', { bubbles: true })
                        );
                }
                expect(pressEnter(init)).toEqual([]);
                fixture.nativeElement
                    .querySelector('input')
                    .dispatchEvent(
                        new KeyboardEvent('keyup', { bubbles: true })
                    );
            }
        );

        it('submits an Android Enter that reports keyCode 229 without a composition', () => {
            expect(pressEnter({ keyCode: 229 })).toEqual(['example query']);
        });
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

    it.each([false, true])(
        'associates the search label with the input when the category dismiss button is %s',
        (canClearCategoryScope) => {
            fixture.componentRef.setInput(
                'searchScopeLabel',
                'Live TV / Sports'
            );
            fixture.componentRef.setInput(
                'canClearCategoryScope',
                canClearCategoryScope
            );
            fixture.detectChanges();

            const label: HTMLLabelElement =
                fixture.nativeElement.querySelector('.search-field');
            expect(label.control).toBe(
                fixture.nativeElement.querySelector('input[type="search"]')
            );
        }
    );

    it('emits add playlist requests when the toolbar add button is clicked', () => {
        const requested = jest.fn();
        component.addPlaylistRequested.subscribe(requested);

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            'button[aria-label="WORKSPACE.SHELL.ADD_PLAYLIST"]'
        );
        button.click();

        expect(requested).toHaveBeenCalledTimes(1);
    });

    it('leaves keyboard shortcuts to the palette, Settings and the ? key', () => {
        const icons = Array.from(
            fixture.nativeElement.querySelectorAll('button mat-icon')
        ).map((icon) => (icon as HTMLElement).textContent?.trim());
        expect(icons).not.toContain('keyboard');
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

    it('hides search without playlists except on the settings route', () => {
        const searchInput = () =>
            fixture.nativeElement.querySelector('input[type="search"]');

        fixture.componentRef.setInput('hasNoPlaylists', true);
        fixture.detectChanges();
        expect(searchInput()).toBeNull();

        // Settings search needs no playlist: a fresh user can still search.
        fixture.componentRef.setInput('isSettingsRoute', true);
        fixture.detectChanges();
        expect(searchInput()).not.toBeNull();
        expect(searchInput().disabled).toBe(false);
    });

    it('never renders a disabled search field', () => {
        const searchField = () =>
            fixture.nativeElement.querySelector('.search-field');

        fixture.componentRef.setInput('canUseSearch', false);
        fixture.detectChanges();
        expect(searchField()).toBeNull();
        // The palette keeps a pointer way in without the field's trigger.
        const requested = jest.fn();
        component.commandPaletteRequested.subscribe(requested);
        const trigger: HTMLButtonElement = fixture.nativeElement.querySelector(
            '[data-test-id="header-command-palette"]'
        );
        trigger.click();
        expect(requested).toHaveBeenCalledTimes(1);

        fixture.componentRef.setInput('canUseSearch', true);
        fixture.detectChanges();
        expect(searchField()).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('input[type="search"]').disabled
        ).toBe(false);
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="header-command-palette"]'
            )
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
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                '.search-chip'
            )
        ).map((element: Element) => element.textContent?.trim());

        expect(chips).toEqual(['Movies / All Items', 'Loaded channels only']);
    });

    it('renders the whole category scope chip as one dismiss button', () => {
        fixture.componentRef.setInput(
            'searchScopeLabel',
            'Live Streams / Sports'
        );
        fixture.componentRef.setInput('canClearCategoryScope', true);
        fixture.detectChanges();

        const clearBtn: HTMLButtonElement | null =
            fixture.nativeElement.querySelector(
                '[data-test-id="workspace-search-scope-clear"]'
            );
        expect(clearBtn).not.toBeNull();
        expect(clearBtn?.tagName).toBe('BUTTON');
        expect(
            clearBtn?.querySelector('.search-chip__label')?.textContent
        ).toBe('Live Streams / Sports');
        expect(clearBtn?.querySelector('button')).toBeNull();
    });

    it('keeps the all-items scope non-interactive', () => {
        fixture.componentRef.setInput('searchScopeLabel', 'Movies / All items');
        fixture.componentRef.setInput('canClearCategoryScope', false);
        fixture.detectChanges();

        const chip: HTMLElement = fixture.nativeElement.querySelector(
            '.search-chip--scope'
        );
        expect(chip.tagName).toBe('SPAN');
        expect(chip.querySelector('button')).toBeNull();
        expect(chip.hasAttribute('tabindex')).toBe(false);
    });

    it.each(['.search-chip__label', 'mat-icon'])(
        'clears the category and focuses search when clicking %s on the chip',
        (targetSelector) => {
            const spy = jest.fn();
            fixture.componentInstance.clearCategoryScopeRequested.subscribe(
                spy
            );
            fixture.componentRef.setInput(
                'searchScopeLabel',
                'Live Streams / Sports'
            );
            fixture.componentRef.setInput('canClearCategoryScope', true);
            fixture.detectChanges();

            const clearBtn: HTMLButtonElement =
                fixture.nativeElement.querySelector(
                    '[data-test-id="workspace-search-scope-clear"]'
                );
            const target = clearBtn.querySelector<HTMLElement>(targetSelector);
            expect(target).not.toBeNull();
            target?.click();
            fixture.detectChanges();

            expect(spy).toHaveBeenCalledTimes(1);
            expect(document.activeElement).toBe(
                fixture.nativeElement.querySelector('input[type="search"]')
            );
        }
    );

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

    describe('page Back', () => {
        const backButton = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-test-id="workspace-header-back"]'
            );

        const drawerToggle = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-test-id="context-drawer-toggle"]'
            );

        function setBackTarget(
            label: string | null,
            escapeShortcut: boolean,
            phoneDrawerToggle?: WorkspaceBackPhoneSlot
        ): WorkspaceBackTarget {
            const target: WorkspaceBackTarget = {
                label: signal(label),
                escapeShortcut: signal(escapeShortcut),
                phoneDrawerToggle,
                run: jest.fn(),
            };
            fixture.componentRef.setInput('backTarget', target);
            fixture.detectChanges();
            return target;
        }

        it('renders nothing while the page has no Back', () => {
            expect(backButton()).toBeNull();
        });

        it('leads the header and emits Back requests', () => {
            const requested = jest.fn();
            component.backRequested.subscribe(requested);
            setBackTarget('Back to Downloads', true);

            const button = backButton();
            expect(
                fixture.nativeElement.querySelector('header')?.firstElementChild
            ).toBe(button);
            expect(button?.type).toBe('button');
            button?.click();

            expect(requested).toHaveBeenCalledTimes(1);
        });

        it('names the page Back and announces Escape only while it applies', () => {
            setBackTarget('Back to Downloads', true);
            expect(backButton()?.getAttribute('aria-label')).toBe(
                'Back to Downloads'
            );
            expect(backButton()?.getAttribute('aria-keyshortcuts')).toBe(
                'Escape'
            );

            setBackTarget(null, false);
            // No host label: the generic translated Back.
            expect(backButton()?.getAttribute('aria-label')).toBe('BACK');
            expect(backButton()?.hasAttribute('aria-keyshortcuts')).toBe(false);
        });

        it('runs the advertised Escape from the focused Back only while it applies', () => {
            const requested = jest.fn();
            component.backRequested.subscribe(requested);
            const press = (init: KeyboardEventInit = {}) => {
                const event = new KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                    ...init,
                });
                backButton()?.dispatchEvent(event);
                return event;
            };

            setBackTarget(null, true);
            press({ repeat: true });
            press({ shiftKey: true });
            expect(requested).not.toHaveBeenCalled();
            expect(press().defaultPrevented).toBe(true);
            expect(requested).toHaveBeenCalledTimes(1);

            // In watch, Escape belongs to the player's close shortcut.
            setBackTarget(null, false);
            expect(press().defaultPrevented).toBe(false);
            expect(requested).toHaveBeenCalledTimes(1);
        });

        it('takes the drawer toggle slot while the page offers Back', () => {
            fixture.componentRef.setInput('showContextDrawerToggle', true);
            setBackTarget(null, true);

            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="context-drawer-toggle"]'
                )
            ).toBeNull();

            fixture.componentRef.setInput('backTarget', null);
            fixture.detectChanges();

            expect(backButton()).toBeNull();
            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="context-drawer-toggle"]'
                )
            ).not.toBeNull();
        });

        it('keeps the drawer toggle after Back for a page whose sections live in the drawer', () => {
            fixture.componentRef.setInput('showContextDrawerToggle', true);
            setBackTarget(null, false, 'beside');

            expect(drawerToggle()).not.toBeNull();
            expect(backButton()?.nextElementSibling).toBe(drawerToggle());
            expect(backButton()?.classList).not.toContain(
                'header-back--yields'
            );
        });

        it('lets the history fallback yield to the drawer toggle at phone width', () => {
            fixture.componentRef.setInput('showContextDrawerToggle', true);
            setBackTarget(null, false, 'yield');

            expect(drawerToggle()).not.toBeNull();
            // Hidden by the ≤640px rule; above it the toggle itself is hidden.
            expect(backButton()?.classList).toContain('header-back--yields');

            // Routes without a drawer keep the fallback at every width.
            fixture.componentRef.setInput('showContextDrawerToggle', false);
            fixture.detectChanges();
            expect(backButton()?.classList).not.toContain(
                'header-back--yields'
            );
        });
    });

    it('hides a yielding Back only in the phone layout', () => {
        const styleSource = readFileSync(
            join(__dirname, 'workspace-shell-header.component.scss'),
            'utf8'
        );
        const phoneStart = styleSource.indexOf('@media (max-width: 640px)');

        expect(styleSource.indexOf('.header-back--yields')).toBeGreaterThan(
            phoneStart
        );
        expect(styleSource.slice(phoneStart)).toMatch(
            /\.header-back--yields\s*\{\s*display:\s*none;/
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

    describe('overflow menu', () => {
        const overflowTrigger = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-test-id="header-overflow-menu"]'
            );
        const inlineAdd = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-test-id="header-add-source"]'
            );
        const inlineLock = (): HTMLButtonElement | null =>
            fixture.nativeElement.querySelector(
                '[data-test-id="header-parental-lock"]'
            );
        const setOverflowCount = (count: number) => {
            (
                component as unknown as {
                    overflowCount: ReturnType<typeof signal<number>>;
                }
            ).overflowCount.set(count);
            fixture.detectChanges();
        };
        const openMenu = () => {
            overflowTrigger()?.click();
            fixture.detectChanges();
            return Array.from(
                document.querySelectorAll<HTMLElement>(
                    '.mat-mdc-menu-panel [mat-menu-item]'
                )
            );
        };

        beforeEach(() => {
            fixture.componentRef.setInput('parentalLockState', 'unlocked');
            fixture.componentRef.setInput('headerShortcut', {
                id: 'live-guide',
                icon: 'view_list',
                tooltipKey: 'guide.tooltip',
                ariaLabelKey: 'guide.aria',
                active: () => true,
                run: () => undefined,
            });
            fixture.detectChanges();
        });

        it('keeps everything inline while nothing overflows', () => {
            setOverflowCount(0);

            expect(overflowTrigger()).toBeNull();
            expect(inlineAdd()).not.toBeNull();
            expect(inlineLock()).not.toBeNull();
        });

        it('never opens a menu for a single action', () => {
            setOverflowCount(1);

            expect(overflowTrigger()).toBeNull();
            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="live-guide"]'
                )
            ).not.toBeNull();
            expect(inlineAdd()).not.toBeNull();
        });

        it('moves two or more actions into the menu in the hide order', () => {
            setOverflowCount(2);

            expect(overflowTrigger()).not.toBeNull();
            expect(
                fixture.nativeElement.querySelector(
                    '[data-test-id="live-guide"]'
                )
            ).toBeNull();
            expect(inlineLock()).toBeNull();
            expect(inlineAdd()).not.toBeNull();

            const items = openMenu();
            const labels = items.map((item) =>
                item.querySelector('span')?.textContent?.trim()
            );
            expect(labels).toEqual(['guide.aria', 'PARENTAL_LOCK.HEADER_LOCK']);
            // The guide is a toggle: its pressed state survives as checked.
            expect(items[0].getAttribute('role')).toBe('menuitemcheckbox');
            expect(items[0].getAttribute('aria-checked')).toBe('true');
        });

        it('runs an overflowed action from its menu row', () => {
            const lockRequested = jest.fn();
            component.parentalLockToggleRequested.subscribe(lockRequested);
            setOverflowCount(3);

            const lockItem = openMenu().find(
                (item) =>
                    item.dataset['testId'] === 'header-parental-lock-menu-item'
            );
            lockItem?.click();

            expect(lockRequested).toHaveBeenCalledTimes(1);
            expect(inlineAdd()).toBeNull();
        });

        it('keeps a disabled action disabled in the menu', () => {
            fixture.componentRef.setInput('headerShortcut', {
                id: 'live-guide',
                icon: 'view_list',
                tooltipKey: 'guide.tooltip',
                ariaLabelKey: 'guide.aria',
                disabled: () => true,
                run: () => undefined,
            });
            setOverflowCount(2);

            const [guideItem] = openMenu();
            expect(guideItem.getAttribute('role')).toBe('menuitem');
            expect((guideItem as HTMLButtonElement).disabled).toBe(true);
        });

        it('drops the divider once no contextual action is inline', () => {
            const global = () =>
                fixture.nativeElement.querySelector('.header-actions--global');

            setOverflowCount(0);
            expect(global().classList).toContain('header-actions--divided');

            setOverflowCount(3);
            expect(
                fixture.nativeElement.querySelector(
                    '.header-actions--contextual'
                )
            ).toBeNull();
            expect(global().classList).not.toContain('header-actions--divided');
        });

        describe('measured from the laid-out header', () => {
            const BUTTON = 40;
            let headerWidth = 0;
            const measure = () => {
                (
                    component as unknown as { measureOverflow(): void }
                ).measureOverflow();
                fixture.detectChanges();
            };

            beforeEach(() => {
                // jsdom has no layout: the header row gets a width, every
                // button 40px, the action cluster the sum of its buttons and
                // every other region 100px.
                jest.spyOn(
                    HTMLElement.prototype,
                    'clientWidth',
                    'get'
                ).mockImplementation(function (this: HTMLElement) {
                    return this.classList.contains('workspace-header')
                        ? headerWidth
                        : 0;
                });
                jest.spyOn(
                    HTMLElement.prototype,
                    'offsetWidth',
                    'get'
                ).mockImplementation(function (this: HTMLElement) {
                    if (this.tagName === 'BUTTON') {
                        return BUTTON;
                    }
                    return this.classList.contains('header-actions-cluster')
                        ? this.querySelectorAll('button').length * BUTTON
                        : 100;
                });
                jest.spyOn(
                    Element.prototype,
                    'getClientRects'
                ).mockImplementation(() => [{}] as unknown as DOMRectList);
            });

            afterEach(() => jest.restoreAllMocks());

            it('keeps the last plan while the header is not laid out', () => {
                setOverflowCount(2);
                headerWidth = 0;

                measure();

                expect(overflowTrigger()).not.toBeNull();
            });

            it('moves actions into the menu when the row runs short', () => {
                headerWidth = 2000;
                measure();
                expect(overflowTrigger()).toBeNull();

                headerWidth = 360;
                measure();
                expect(overflowTrigger()).not.toBeNull();
                expect(openMenu().length).toBeGreaterThanOrEqual(2);
            });

            it('hands focus to the menu trigger when the focused action moves', async () => {
                headerWidth = 2000;
                measure();
                const actions: HTMLButtonElement[] = Array.from(
                    fixture.nativeElement.querySelectorAll(
                        '.header-actions--contextual button'
                    )
                );
                expect(actions.length).toBeGreaterThan(0);
                actions[0].focus();

                headerWidth = 360;
                measure();
                await fixture.whenStable();

                expect(document.activeElement).toBe(overflowTrigger());
            });

            it('hands focus to the last action when the menu trigger leaves', async () => {
                headerWidth = 360;
                measure();
                overflowTrigger()?.focus();
                expect(document.activeElement).toBe(overflowTrigger());

                headerWidth = 2000;
                measure();
                await fixture.whenStable();

                expect(overflowTrigger()).toBeNull();
                const buttons: HTMLButtonElement[] = Array.from(
                    fixture.nativeElement.querySelectorAll(
                        '.header-actions-cluster button'
                    )
                );
                expect(document.activeElement).toBe(
                    buttons[buttons.length - 1]
                );
            });

            it('leaves focus alone when it is outside the actions', async () => {
                headerWidth = 2000;
                measure();
                const input: HTMLInputElement =
                    fixture.nativeElement.querySelector('input[type="search"]');
                input.focus();

                headerWidth = 360;
                measure();
                await fixture.whenStable();

                expect(document.activeElement).toBe(input);
            });

            it('settles on the same plan when measured again', () => {
                headerWidth = 400;
                measure();
                const first = overflowTrigger() !== null;

                measure();
                measure();

                expect(overflowTrigger() !== null).toBe(first);
            });
        });
    });

    it('stops observing header regions that leave the row', () => {
        // Other observers (CDK, layout slide) share the stub: track each one
        // and check the one that watches the header row.
        const observers: Set<Element>[] = [];
        const original = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class {
            private readonly observed = new Set<Element>();
            constructor() {
                observers.push(this.observed);
            }
            observe(element: Element) {
                this.observed.add(element);
            }
            unobserve(element: Element) {
                this.observed.delete(element);
            }
            disconnect() {
                this.observed.clear();
            }
        } as unknown as typeof ResizeObserver;
        try {
            const observedFixture = TestBed.createComponent(
                WorkspaceShellHeaderComponent
            );
            observedFixture.componentRef.setInput('canUseSearch', true);
            observedFixture.detectChanges();
            const root: HTMLElement = observedFixture.nativeElement;
            const header = root.querySelector('.workspace-header') as Element;
            const switcher = root.querySelector(
                '.playlist-switcher'
            ) as Element;
            const observed = observers.find((set) => set.has(header));
            expect(observed?.has(switcher)).toBe(true);

            // Settings drops the playlist switcher from the row.
            observedFixture.componentRef.setInput('isSettingsRoute', true);
            observedFixture.detectChanges();

            expect(switcher.isConnected).toBe(false);
            expect(observed?.has(switcher)).toBe(false);
            expect(observed?.has(header)).toBe(true);
            observedFixture.destroy();
        } finally {
            globalThis.ResizeObserver = original;
        }
    });
});
