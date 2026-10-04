import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { WorkspaceBackTarget } from '@iptvnator/portal/shared/util';
import {
    WORKSPACE_HISTORY_NAVIGATION,
    WorkspaceBackNavigationService,
    WorkspaceHistoryNavigation,
} from './workspace-back-navigation.service';

/** Session history as the Navigation API reports it. */
class FakeHistory extends EventTarget {
    private list: { index: number; sameDocument: boolean }[] = [];
    private current = -1;

    constructor(sameDocument: boolean[] = [true]) {
        super();
        sameDocument.forEach((same) => this.push(same, false));
    }

    get currentEntry() {
        return this.list[this.current] ?? null;
    }

    entries() {
        return this.list;
    }

    /** A router push; earlier documents' entries are not same-document. */
    push(sameDocument = true, notify = true): void {
        this.list = this.list.slice(0, this.current + 1);
        this.list.push({ index: this.list.length, sameDocument });
        this.current = this.list.length - 1;
        if (notify) this.dispatchEvent(new Event('currententrychange'));
    }

    traverseTo(index: number): void {
        this.current = index;
        this.dispatchEvent(new Event('currententrychange'));
    }
}

describe('WorkspaceBackNavigationService', () => {
    const back = jest.fn();
    const navigate = jest.fn().mockResolvedValue(true);
    const navigateByUrl = jest.fn().mockResolvedValue(true);

    function createService(
        history: FakeHistory | null = null
    ): WorkspaceBackNavigationService {
        back.mockReset();
        navigate.mockClear();
        navigateByUrl.mockClear();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: Location, useValue: { back } },
                { provide: Router, useValue: { navigate, navigateByUrl } },
                {
                    provide: WORKSPACE_HISTORY_NAVIGATION,
                    useValue: history as unknown as WorkspaceHistoryNavigation,
                },
            ],
        });
        return TestBed.inject(WorkspaceBackNavigationService);
    }

    function createTarget(run = jest.fn()): WorkspaceBackTarget {
        return {
            label: signal<string | null>(null),
            escapeShortcut: signal(true),
            run,
        };
    }

    it('has no target until a page registers one', () => {
        const service = createService();

        expect(service.target()).toBeNull();
        expect(service.goBack()).toBe(false);
    });

    it('runs the most recently registered target', () => {
        const service = createService();
        const first = createTarget();
        const second = createTarget();

        service.register(first);
        service.register(second);

        expect(service.target()).toBe(second);
        expect(service.goBack()).toBe(true);
        expect(second.run).toHaveBeenCalledTimes(1);
        expect(first.run).not.toHaveBeenCalled();
    });

    it('hands the slot back to the previous target on release', () => {
        const service = createService();
        const first = createTarget();
        const second = createTarget();

        service.register(first);
        const releaseSecond = service.register(second);
        releaseSecond();

        expect(service.target()).toBe(first);
    });

    it('keeps a replacement page when the replaced one releases afterwards', () => {
        const service = createService();
        const loading = createTarget();
        const loaded = createTarget();

        const releaseLoading = service.register(loading);
        service.register(loaded);
        releaseLoading();

        expect(service.target()).toBe(loaded);
    });

    it('moves a re-registered target to the top without duplicating it', () => {
        const service = createService();
        const first = createTarget();
        const second = createTarget();

        const releaseFirst = service.register(first);
        service.register(second);
        service.register(first);
        releaseFirst();

        expect(service.target()).toBe(second);
    });

    describe('history fallback', () => {
        it('shows nothing on the first page of the session', () => {
            const service = createService(new FakeHistory());

            expect(service.target()).toBeNull();
            expect(service.goBack()).toBe(false);
        });

        it('goes back in history once the router pushed a page', () => {
            const history = new FakeHistory();
            const service = createService(history);

            history.push();
            const target = service.target();

            expect(target?.label()).toBeNull();
            // No page handles Escape, and a list keeps its phone drawer.
            expect(target?.escapeShortcut()).toBe(false);
            expect(target?.phoneDrawerToggle).toBe('yield');
            expect(service.goBack()).toBe(true);
            expect(back).toHaveBeenCalledTimes(1);
        });

        it('disappears when Back returns to the first page and returns on Forward', () => {
            const history = new FakeHistory();
            const service = createService(history);
            history.push();

            history.traverseTo(0);
            expect(service.target()).toBeNull();

            history.traverseTo(1);
            expect(service.target()).not.toBeNull();
        });

        it('never leads out of the app or across a reload', () => {
            // An entry from another page of the origin, or from this app's
            // document before a reload, belongs to a different document.
            const service = createService(new FakeHistory([false, true]));

            expect(service.target()).toBeNull();
        });

        it('yields to a page that registers Back and returns after it goes', () => {
            const history = new FakeHistory();
            const service = createService(history);
            history.push();
            const fallback = service.target();
            const page = createTarget();

            const release = service.register(page);
            expect(service.target()).toBe(page);

            release();
            expect(service.target()).toBe(fallback);
        });

        it('is absent without the Navigation API', () => {
            const service = createService(null);

            expect(service.target()).toBeNull();
        });

        it('stops listening when the injector is destroyed', () => {
            const history = new FakeHistory();
            const remove = jest.spyOn(history, 'removeEventListener');
            createService(history);

            TestBed.resetTestingModule();

            expect(remove).toHaveBeenCalledWith(
                'currententrychange',
                expect.any(Function)
            );
        });
    });

    describe('back to a parent', () => {
        it('goes back in history while the previous entry is in-app', () => {
            const history = new FakeHistory();
            const service = createService(history);
            history.push();
            const parent = jest.fn(() => '/workspace/dashboard');

            service.back(parent);

            expect(back).toHaveBeenCalledTimes(1);
            expect(parent).not.toHaveBeenCalled();
            expect(navigateByUrl).not.toHaveBeenCalled();
        });

        it('opens the parent in place of a page that opened the session', async () => {
            const service = createService(new FakeHistory());

            service.back(() => '/workspace/dashboard');
            await Promise.resolve();

            // Replacing keeps history Back from returning to the page.
            expect(navigateByUrl).toHaveBeenCalledWith('/workspace/dashboard', {
                replaceUrl: true,
            });
            expect(back).not.toHaveBeenCalled();
        });

        it('opens the parent after a reload, whose old entries do not count', async () => {
            const service = createService(new FakeHistory([false, true]));

            service.back(() => ['/workspace', 'xtreams', 'pl/1', 'vod']);
            await Promise.resolve();

            expect(navigate).toHaveBeenCalledWith(
                ['/workspace', 'xtreams', 'pl/1', 'vod'],
                { replaceUrl: true }
            );
            expect(back).not.toHaveBeenCalled();
        });

        it('waits for a parent that resolves asynchronously', async () => {
            const service = createService(new FakeHistory());

            service.back(() => Promise.resolve('/workspace/sources'));
            await Promise.resolve();
            await Promise.resolve();

            expect(navigateByUrl).toHaveBeenCalledWith('/workspace/sources', {
                replaceUrl: true,
            });
        });

        it('keeps browser history when the page knows no parent', async () => {
            const service = createService(new FakeHistory());

            service.back(() => null);
            await Promise.resolve();

            expect(back).toHaveBeenCalledTimes(1);
            expect(navigate).not.toHaveBeenCalled();
            expect(navigateByUrl).not.toHaveBeenCalled();
        });

        it('keeps browser history without the Navigation API', () => {
            // The history is unknown there, so a reached page must not
            // jump to its parent.
            const service = createService(null);
            const parent = jest.fn(() => '/workspace/dashboard');

            service.back(parent);

            expect(back).toHaveBeenCalledTimes(1);
            expect(parent).not.toHaveBeenCalled();
        });
    });
});
