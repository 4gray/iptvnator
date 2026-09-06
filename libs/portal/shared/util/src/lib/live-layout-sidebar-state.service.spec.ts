import { TestBed } from '@angular/core/testing';
import { LiveLayoutSidebarStateService } from './live-layout-sidebar-state.service';
import { LIVE_SIDEBAR_STATE_STORAGE_KEY } from './live-sidebar-state';

describe('LiveLayoutSidebarStateService', () => {
    function createService(): LiveLayoutSidebarStateService {
        TestBed.resetTestingModule();
        return TestBed.inject(LiveLayoutSidebarStateService);
    }

    afterEach(() => {
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
    });

    it('starts expanded with nothing stored', () => {
        const service = createService();

        expect(service.state()).toBe('expanded');
        expect(service.isCollapsed()).toBe(false);
        expect(service.areCategoriesHidden()).toBe(false);
    });

    it('folds only the categories rail on hideCategories', () => {
        const service = createService();

        service.hideCategories();

        expect(service.state()).toBe('categories-hidden');
        expect(service.areCategoriesHidden()).toBe(true);
        expect(service.isCollapsed()).toBe(false);
        expect(localStorage.getItem(LIVE_SIDEBAR_STATE_STORAGE_KEY)).toBe(
            'categories-hidden'
        );

        service.showCategories();

        expect(service.state()).toBe('expanded');
    });

    it('collapse folds both rails and expand returns to the level it was entered from', () => {
        const service = createService();
        service.hideCategories();

        service.collapse();

        expect(service.isCollapsed()).toBe(true);
        expect(service.areCategoriesHidden()).toBe(true);

        service.expand();

        expect(service.state()).toBe('categories-hidden');
    });

    it('toggle leaves collapsed for the previous level and otherwise collapses', () => {
        const service = createService();

        service.toggle();
        expect(service.state()).toBe('collapsed');

        service.toggle();
        expect(service.state()).toBe('expanded');

        service.hideCategories();
        service.toggle();
        expect(service.state()).toBe('collapsed');

        service.toggle();
        expect(service.state()).toBe('categories-hidden');
    });

    it('does not let a repeated collapse forget the level to come back to', () => {
        const service = createService();
        service.hideCategories();

        service.collapse();
        service.collapse();
        service.expand();

        expect(service.state()).toBe('categories-hidden');
    });

    it('restores a hidden categories rail across construction and never restores collapsed', () => {
        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'categories-hidden');
        expect(createService().state()).toBe('categories-hidden');

        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'collapsed');
        const service = createService();
        expect(service.state()).toBe('categories-hidden');
        expect(localStorage.getItem(LIVE_SIDEBAR_STATE_STORAGE_KEY)).toBe(
            'categories-hidden'
        );

        // The stored level is the one Cmd/Ctrl+B comes back to.
        service.toggle();
        service.toggle();
        expect(service.state()).toBe('categories-hidden');
    });
});
