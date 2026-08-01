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
