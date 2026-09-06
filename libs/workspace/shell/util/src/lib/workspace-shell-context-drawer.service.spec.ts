import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { WorkspaceShellContextDrawerService } from './workspace-shell-context-drawer.service';

describe('WorkspaceShellContextDrawerService', () => {
    let service: WorkspaceShellContextDrawerService;
    let routerEvents: Subject<unknown>;

    beforeEach(() => {
        routerEvents = new Subject();
        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellContextDrawerService,
                {
                    provide: Router,
                    useValue: { events: routerEvents.asObservable() },
                },
            ],
        });
        service = TestBed.inject(WorkspaceShellContextDrawerService);
    });


    it('opens on demand and stays open until closed', () => {
        const service = TestBed.inject(WorkspaceShellContextDrawerService);

        service.open();
        expect(service.isOpen()).toBe(true);
        service.open();
        expect(service.isOpen()).toBe(true);
        service.close();
        expect(service.isOpen()).toBe(false);
    });

    it('starts closed', () => {
        expect(service.isOpen()).toBe(false);
    });

    it('toggles open and closed', () => {
        service.toggle();
        expect(service.isOpen()).toBe(true);

        service.toggle();
        expect(service.isOpen()).toBe(false);
    });

    it('closes explicitly and stays closed on repeated close', () => {
        service.toggle();
        service.close();
        service.close();

        expect(service.isOpen()).toBe(false);
    });

    it('closes when a navigation completes', () => {
        service.toggle();

        routerEvents.next(new NavigationEnd(1, '/workspace/a', '/workspace/a'));

        expect(service.isOpen()).toBe(false);
    });

    it('ignores router events other than NavigationEnd', () => {
        service.toggle();

        routerEvents.next(new NavigationStart(1, '/workspace/a'));

        expect(service.isOpen()).toBe(true);
    });
});

describe('WorkspaceShellContextDrawerService viewport tracking', () => {
    let changeListener: ((event: { matches: boolean }) => void) | undefined;
    let removeEventListener: jest.Mock;

    beforeEach(() => {
        removeEventListener = jest.fn();
        // JSDOM has no matchMedia; the service treats its absence as
        // "no viewport tracking", so a mock is required to reach the path.
        (window as { matchMedia?: unknown }).matchMedia = jest.fn(() => ({
            matches: true,
            addEventListener: (
                _type: string,
                listener: (event: { matches: boolean }) => void
            ) => {
                changeListener = listener;
            },
            removeEventListener,
        }));
    });

    afterEach(() => {
        delete (window as { matchMedia?: unknown }).matchMedia;
        changeListener = undefined;
    });

    function createService(): WorkspaceShellContextDrawerService {
        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellContextDrawerService,
                {
                    provide: Router,
                    useValue: { events: new Subject().asObservable() },
                },
            ],
        });
        return TestBed.inject(WorkspaceShellContextDrawerService);
    }

    it('closes when the viewport leaves the phone breakpoint', () => {
        const service = createService();
        service.toggle();

        changeListener?.({ matches: false });

        expect(service.isOpen()).toBe(false);
    });

    it('stays open while the viewport remains at phone width', () => {
        const service = createService();
        service.toggle();

        changeListener?.({ matches: true });

        expect(service.isOpen()).toBe(true);
    });
});
