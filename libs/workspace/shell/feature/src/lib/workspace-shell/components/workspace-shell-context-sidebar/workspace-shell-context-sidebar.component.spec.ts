import { Component, Directive, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { LiveLayoutSidebarStateService } from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { WorkspaceShellContextSidebarComponent } from './workspace-shell-context-sidebar.component';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
class MockResizableDirective {
    readonly minWidth = input<number | null>(null);
    readonly maxWidth = input<number | null>(null);
    readonly defaultWidth = input<number | null>(null);
    readonly storageKey = input<string | null>(null);
}

@Component({
    selector: 'app-workspace-context-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceContextPanelComponent {
    readonly context = input.required<unknown>();
    readonly section = input.required<string>();
}

@Component({
    selector: 'app-workspace-collection-context-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceCollectionContextPanelComponent {}

@Component({
    selector: 'app-workspace-settings-context-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceSettingsContextPanelComponent {}

@Component({
    selector: 'app-workspace-sources-filters-panel',
    template: '',
    standalone: true,
})
class MockWorkspaceSourcesFiltersPanelComponent {}

describe('WorkspaceShellContextSidebarComponent', () => {
    let fixture: ComponentFixture<WorkspaceShellContextSidebarComponent>;
    let liveSidebarService: LiveLayoutSidebarStateService;
    const xtreamSelectedCategoryId = signal<number | null>(1);
    const stalkerSelectedCategoryId = signal<string | null>('7');
    const drawerOpen = signal(false);

    beforeEach(async () => {
        localStorage.removeItem('live-sidebar-state');
        xtreamSelectedCategoryId.set(1);
        stalkerSelectedCategoryId.set('7');
        drawerOpen.set(false);

        await TestBed.configureTestingModule({
            imports: [WorkspaceShellContextSidebarComponent],
            providers: [
                {
                    provide: WorkspaceShellContextDrawerService,
                    useValue: { close: jest.fn(), isOpen: drawerOpen },
                },
                {
                    provide: XtreamStore,
                    useValue: { selectedCategoryId: xtreamSelectedCategoryId },
                },
                {
                    provide: StalkerStore,
                    useValue: { selectedCategoryId: stalkerSelectedCategoryId },
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
        })
            .overrideComponent(WorkspaceShellContextSidebarComponent, {
                set: {
                    imports: [
                        MatIcon,
                        MockResizableDirective,
                        MockWorkspaceContextPanelComponent,
                        MockWorkspaceCollectionContextPanelComponent,
                        MockWorkspaceSettingsContextPanelComponent,
                        MockWorkspaceSourcesFiltersPanelComponent,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WorkspaceShellContextSidebarComponent);
        liveSidebarService = TestBed.inject(LiveLayoutSidebarStateService);
        liveSidebarService.setState('expanded');
    });

    it('closes the phone drawer from its always-available close button', () => {
        fixture.componentRef.setInput('variant', 'settings');
        fixture.detectChanges();

        const button: HTMLButtonElement = fixture.nativeElement.querySelector(
            '[data-test-id="context-drawer-close"]'
        );
        expect(button).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBe('CLOSE');

        button.click();

        const drawer = TestBed.inject(
            WorkspaceShellContextDrawerService
        ) as unknown as { close: jest.Mock };
        expect(drawer.close).toHaveBeenCalledTimes(1);
    });

    it('renders the settings panel for the settings variant', () => {
        fixture.componentRef.setInput('variant', 'settings');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-settings-context-panel'
            )
        ).not.toBeNull();
    });

    it('renders the route context panel for category routes', () => {
        fixture.componentRef.setInput('variant', 'category');
        fixture.componentRef.setInput('context', {
            provider: 'xtreams',
            playlistId: 'pl-1',
        });
        fixture.componentRef.setInput('section', 'vod');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-workspace-context-panel')
        ).not.toBeNull();
    });

    it('renders the shared collection panel for collection routes', () => {
        fixture.componentRef.setInput('variant', 'collection');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                'app-workspace-collection-context-panel'
            )
        ).not.toBeNull();
    });

    describe('live sidebar collapse', () => {
        function setupLiveCategory(section: 'live' | 'itv' | 'vod'): void {
            fixture.componentRef.setInput('variant', 'category');
            fixture.componentRef.setInput('context', {
                provider: 'xtreams',
                playlistId: 'pl-1',
            });
            fixture.componentRef.setInput('section', section);
            fixture.detectChanges();
        }

        it('collapses the categories rail when the shared service is collapsed on a live route', () => {
            setupLiveCategory('live');

            liveSidebarService.setState('collapsed');
            fixture.detectChanges();

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                true
            );
        });

        it('folds the categories rail on the first level already (categories-hidden)', () => {
            setupLiveCategory('live');

            liveSidebarService.setState('categories-hidden');
            fixture.detectChanges();

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                true
            );
        });

        it('keeps the rail on the live root (no selected category) at categories-hidden, since no channels rail exists to host the way back', () => {
            xtreamSelectedCategoryId.set(null);
            setupLiveCategory('live');

            liveSidebarService.setState('categories-hidden');
            fixture.detectChanges();

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                false
            );

            // Player-only still folds it: the floating restore handle lives
            // in the content area and stays reachable there.
            liveSidebarService.setState('collapsed');
            fixture.detectChanges();
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                true
            );
        });

        it('takes the folded rail out of the focus order with inert, except inside the open phone drawer', () => {
            setupLiveCategory('live');
            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );

            liveSidebarService.setState('categories-hidden');
            fixture.detectChanges();
            expect(aside.hasAttribute('inert')).toBe(true);

            drawerOpen.set(true);
            fixture.detectChanges();
            expect(aside.hasAttribute('inert')).toBe(false);

            drawerOpen.set(false);
            liveSidebarService.setState('expanded');
            fixture.detectChanges();
            expect(aside.hasAttribute('inert')).toBe(false);
        });

        it('also collapses on the Stalker itv section', () => {
            setupLiveCategory('itv');

            liveSidebarService.setState('collapsed');
            fixture.detectChanges();

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                true
            );
        });

        it('does not collapse the categories rail on non-live sections', () => {
            setupLiveCategory('vod');

            liveSidebarService.setState('collapsed');
            fixture.detectChanges();

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                false
            );
        });

        it('keeps the categories rail expanded when the service is expanded', () => {
            setupLiveCategory('live');

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                false
            );
        });
    });
});
