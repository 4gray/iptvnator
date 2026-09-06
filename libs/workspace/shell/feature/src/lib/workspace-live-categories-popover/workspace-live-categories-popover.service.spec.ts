import { OverlayModule } from '@angular/cdk/overlay';
import {
    ApplicationRef,
    Component,
    input,
    output,
    signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { Subject, of } from 'rxjs';
import {
    LIVE_SIDEBAR_STATE_STORAGE_KEY,
    LiveLayoutSidebarStateService,
} from '@iptvnator/portal/shared/util';
import { WorkspaceContextPanelComponent } from '../workspace-context-panel/workspace-context-panel.component';
import { WorkspaceShellRouteStateService } from '../workspace-shell/services/workspace-shell-route-state.service';
import { WorkspaceLiveCategoriesPopoverComponent } from './workspace-live-categories-popover.component';
import { WorkspaceLiveCategoriesPopoverService } from './workspace-live-categories-popover.service';

@Component({
    selector: 'app-workspace-context-panel',
    template: `<div data-test-id="stub-context-panel">{{ section() }}</div>
        <button data-test-id="stub-pick" (click)="categorySelected.emit()">
            pick
        </button>`,
    standalone: true,
})
class StubWorkspaceContextPanelComponent {
    readonly context = input.required<unknown>();
    readonly section = input.required<string>();
    readonly presentation = input<'sidebar' | 'popover'>('sidebar');
    readonly categorySelected = output<void>();
}

describe('WorkspaceLiveCategoriesPopoverService', () => {
    let service: WorkspaceLiveCategoriesPopoverService;
    let sidebarState: LiveLayoutSidebarStateService;
    let origin: HTMLButtonElement;
    let routerEvents: Subject<unknown>;

    // Portal-attached views render on the next application tick; no fixture
    // drives change detection here.
    function open(): void {
        service.open(origin);
        TestBed.inject(ApplicationRef).tick();
    }

    function pane(): HTMLElement | null {
        return document.querySelector(
            '.workspace-live-categories-popover-pane'
        );
    }

    beforeEach(async () => {
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
        routerEvents = new Subject();
        await TestBed.configureTestingModule({
            imports: [OverlayModule, NoopAnimationsModule],
            providers: [
                WorkspaceLiveCategoriesPopoverService,
                {
                    provide: Router,
                    useValue: { events: routerEvents.asObservable() },
                },
                {
                    provide: WorkspaceShellRouteStateService,
                    useValue: {
                        currentContext: signal({
                            provider: 'xtreams',
                            playlistId: 'pl-1',
                        }),
                        currentSection: signal('live'),
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
        })
            .overrideComponent(WorkspaceLiveCategoriesPopoverComponent, {
                remove: {
                    imports: [WorkspaceContextPanelComponent, TranslatePipe],
                },
                add: {
                    imports: [
                        StubWorkspaceContextPanelComponent,
                        MockPipe(TranslatePipe, (value: string) => value),
                    ],
                },
            })
            .compileComponents();

        service = TestBed.inject(WorkspaceLiveCategoriesPopoverService);
        sidebarState = TestBed.inject(LiveLayoutSidebarStateService);
        sidebarState.hideCategories();
        origin = document.createElement('button');
        document.body.appendChild(origin);
    });

    afterEach(() => {
        service.close();
        origin.remove();
        sidebarState.setState('expanded');
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
    });

    it('opens the categories panel in popover presentation under the origin', () => {
        open();

        const panel = pane()?.querySelector(
            '[data-test-id="stub-context-panel"]'
        );
        expect(panel).not.toBeNull();
        expect(panel?.textContent).toContain('live');
        expect(origin.getAttribute('aria-expanded')).toBe('true');
    });

    it('toggles closed when opened again from the same origin', () => {
        open();
        open();

        expect(pane()).toBeNull();
        expect(origin.getAttribute('aria-expanded')).toBe('false');
    });

    it('restores the rail from the footer and closes', () => {
        open();

        (
            pane()?.querySelector(
                '[data-test-id="live-categories-popover-show-panel"]'
            ) as HTMLButtonElement
        ).click();

        expect(sidebarState.state()).toBe('expanded');
        expect(pane()).toBeNull();
    });

    it('closes after a category selection', () => {
        open();

        (
            pane()?.querySelector(
                '[data-test-id="stub-pick"]'
            ) as HTMLButtonElement
        ).click();

        expect(pane()).toBeNull();
        expect(sidebarState.state()).toBe('categories-hidden');
    });

    it('closes on backdrop click and leaves the rail folded', () => {
        open();

        const backdrop = document.querySelector(
            '.cdk-overlay-backdrop'
        ) as HTMLElement;
        expect(backdrop).not.toBeNull();
        backdrop.click();

        expect(pane()).toBeNull();
        expect(sidebarState.state()).toBe('categories-hidden');
    });

    it('is a labelled modal dialog that traps and takes focus on open', async () => {
        // JSDOM lays nothing out, so the CDK interactivity checker sees every
        // element as invisible and never focuses one; give them geometry.
        const geometry = jest
            .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
            .mockReturnValue(10);
        try {
            open();
            // CdkTrapFocus captures focus once the zone settles.
            await new Promise((resolve) => setTimeout(resolve));

            const host = pane()?.querySelector(
                'app-workspace-live-categories-popover'
            );
            expect(host?.getAttribute('role')).toBe('dialog');
            expect(host?.getAttribute('aria-modal')).toBe('true');
            expect(host?.getAttribute('aria-label')).toBe(
                'LAYOUT.CHOOSE_CATEGORY'
            );
            expect(
                pane()?.querySelectorAll('.cdk-focus-trap-anchor').length
            ).toBe(2);
            expect(host?.contains(document.activeElement)).toBe(true);

            service.close();

            expect(document.activeElement).toBe(origin);
        } finally {
            geometry.mockRestore();
        }
    });

    it('closes when a navigation starts, so it cannot float over the next route', () => {
        open();

        routerEvents.next(new NavigationEnd(1, '/a', '/a'));
        expect(pane()).not.toBeNull();

        routerEvents.next(new NavigationStart(2, '/b'));

        expect(pane()).toBeNull();
    });

    it('closes on Escape', () => {
        open();

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );

        expect(pane()).toBeNull();
    });
});
