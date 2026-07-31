import { Component, Directive, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    LiveLayoutPanelStateService,
    LIVE_LAYOUT_PANEL,
} from '@iptvnator/portal/shared/data-access';
import { BehaviorSubject } from 'rxjs';
import { WorkspaceShellContextSidebarComponent } from './workspace-shell-context-sidebar.component';

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
    template:
        '<button data-testid="live-groups-panel-hide">Hide Groups</button>',
    standalone: true,
})
class MockWorkspaceContextPanelComponent {
    readonly context = input.required<unknown>();
    readonly section = input.required<string>();
    readonly groupsPanelExpanded = input(true);
    readonly groupsPanelExpandedChange = output<boolean>();
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
    let livePanelState: LiveLayoutPanelStateService;
    let breakpointState: BehaviorSubject<BreakpointState>;

    beforeEach(async () => {
        localStorage.removeItem('live-sidebar-state');
        localStorage.removeItem('live-groups-panel-state');
        localStorage.removeItem('live-channels-panel-state');
        breakpointState = new BehaviorSubject<BreakpointState>({
            breakpoints: {},
            matches: false,
        });

        await TestBed.configureTestingModule({
            imports: [
                WorkspaceShellContextSidebarComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: BreakpointObserver,
                    useValue: {
                        observe: () => breakpointState.asObservable(),
                    },
                },
            ],
        })
            .overrideComponent(WorkspaceShellContextSidebarComponent, {
                set: {
                    imports: [
                        MockResizableDirective,
                        MockWorkspaceContextPanelComponent,
                        MockWorkspaceCollectionContextPanelComponent,
                        MockWorkspaceSettingsContextPanelComponent,
                        MockWorkspaceSourcesFiltersPanelComponent,
                        MatIcon,
                        MatIconButton,
                        MatTooltip,
                        TranslateModule,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(
            WorkspaceShellContextSidebarComponent
        );
        livePanelState = TestBed.inject(LiveLayoutPanelStateService);
        livePanelState.showPanel(LIVE_LAYOUT_PANEL.GROUPS);
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

            livePanelState.hidePanel(LIVE_LAYOUT_PANEL.GROUPS);
            fixture.detectChanges();

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            );
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                true
            );
        });

        it('also collapses on the Stalker itv section', () => {
            setupLiveCategory('itv');

            livePanelState.hidePanel(LIVE_LAYOUT_PANEL.GROUPS);
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

            livePanelState.hidePanel(LIVE_LAYOUT_PANEL.GROUPS);
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

        it('suppresses Groups responsively without changing persisted intent', () => {
            setupLiveCategory('live');
            breakpointState.next({
                breakpoints: { '(max-width: 1023px)': true },
                matches: true,
            });
            fixture.detectChanges();

            const aside = fixture.nativeElement.querySelector(
                'aside.context-panel--route'
            ) as HTMLElement;
            expect(aside.classList.contains('context-panel--collapsed')).toBe(
                true
            );
            expect(aside.hasAttribute('inert')).toBe(true);
            expect(livePanelState.groupsIntent()).toBe('expanded');
            expect(
                fixture.nativeElement.querySelector(
                    '[data-testid="live-groups-panel-restore"]'
                )
            ).toBeNull();
        });

        it('restores Groups from a boundary rail and transfers focus both ways', async () => {
            setupLiveCategory('live');
            livePanelState.hidePanel(LIVE_LAYOUT_PANEL.GROUPS);
            fixture.detectChanges();
            await Promise.resolve();

            const restore = fixture.nativeElement.querySelector(
                '[data-testid="live-groups-panel-restore"]'
            ) as HTMLButtonElement;
            expect(restore.getAttribute('aria-controls')).toBe(
                'live-groups-panel'
            );
            expect(document.activeElement).toBe(restore);

            restore.click();
            fixture.detectChanges();
            await Promise.resolve();

            expect(livePanelState.groupsIntent()).toBe('expanded');
            expect(document.activeElement).toBe(
                fixture.nativeElement.querySelector(
                    '[data-testid="live-groups-panel-hide"]'
                )
            );
        });
    });
});
