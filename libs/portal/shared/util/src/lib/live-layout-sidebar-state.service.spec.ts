import { TestBed } from '@angular/core/testing';
import { LiveLayoutSidebarStateService } from './live-layout-sidebar-state.service';
import {
    LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY,
    LIVE_SIDEBAR_SURFACES,
    liveSidebarStateStorageKey,
} from './live-sidebar-state';

describe('LiveLayoutSidebarStateService', () => {
    function clearStorage(): void {
        localStorage.removeItem(LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY);
        for (const surface of LIVE_SIDEBAR_SURFACES) {
            localStorage.removeItem(liveSidebarStateStorageKey(surface));
        }
    }

    function createService(): LiveLayoutSidebarStateService {
        TestBed.resetTestingModule();
        return TestBed.inject(LiveLayoutSidebarStateService);
    }

    beforeEach(clearStorage);
    afterEach(clearStorage);

    it('starts every surface expanded', () => {
        const service = createService();

        for (const surface of LIVE_SIDEBAR_SURFACES) {
            expect(service.stateOf(surface)()).toBe('expanded');
            expect(service.isCollapsedFor(surface)()).toBe(false);
        }
    });

    it('keeps surfaces independent: collapsing the M3U rail leaves portals and collections alone', () => {
        const service = createService();

        service.toggle('m3u');

        expect(service.isCollapsedFor('m3u')()).toBe(true);
        expect(service.isCollapsedFor('portal')()).toBe(false);
        expect(service.isCollapsedFor('collection')()).toBe(false);
        expect(localStorage.getItem(liveSidebarStateStorageKey('m3u'))).toBe(
            'collapsed'
        );
        expect(
            localStorage.getItem(liveSidebarStateStorageKey('portal'))
        ).toBeNull();
    });

    it('returns the same signal instance per surface so components can hold it', () => {
        const service = createService();

        expect(service.isCollapsedFor('portal')).toBe(
            service.isCollapsedFor('portal')
        );
        expect(service.isCollapsedFor('portal')).not.toBe(
            service.isCollapsedFor('collection')
        );
    });

    it('restores each surface from its own storage key', () => {
        localStorage.setItem(liveSidebarStateStorageKey('portal'), 'collapsed');

        const service = createService();

        expect(service.isCollapsedFor('portal')()).toBe(true);
        expect(service.isCollapsedFor('m3u')()).toBe(false);

        service.setState('portal', 'expanded');

        expect(localStorage.getItem(liveSidebarStateStorageKey('portal'))).toBe(
            'expanded'
        );
    });

    it('folds only the categories rail on hideCategories', () => {
        const service = createService();

        service.hideCategories('portal');

        expect(service.stateOf('portal')()).toBe('categories-hidden');
        expect(service.areCategoriesHiddenFor('portal')()).toBe(true);
        expect(service.isCollapsedFor('portal')()).toBe(false);
        expect(service.areCategoriesHiddenFor('m3u')()).toBe(false);
        expect(
            localStorage.getItem(liveSidebarStateStorageKey('portal'))
        ).toBe('categories-hidden');

        service.showCategories('portal');

        expect(service.stateOf('portal')()).toBe('expanded');
    });

    it('collapse folds both rails and expand returns to the level it was entered from', () => {
        const service = createService();
        service.hideCategories('portal');

        service.collapse('portal');

        expect(service.isCollapsedFor('portal')()).toBe(true);
        expect(service.areCategoriesHiddenFor('portal')()).toBe(true);

        service.collapse('portal');
        service.expand('portal');

        expect(service.stateOf('portal')()).toBe('categories-hidden');
    });

    it('toggle leaves collapsed for the previous level and otherwise collapses', () => {
        const service = createService();

        service.toggle('portal');
        expect(service.stateOf('portal')()).toBe('collapsed');
        service.toggle('portal');
        expect(service.stateOf('portal')()).toBe('expanded');

        service.hideCategories('portal');
        service.toggle('portal');
        expect(service.stateOf('portal')()).toBe('collapsed');
        service.toggle('portal');
        expect(service.stateOf('portal')()).toBe('categories-hidden');
    });

    it('restores a hidden categories rail from its surface key and comes back to it after a toggle', () => {
        localStorage.setItem(
            liveSidebarStateStorageKey('portal'),
            'categories-hidden'
        );

        const service = createService();
        expect(service.stateOf('portal')()).toBe('categories-hidden');

        service.toggle('portal');
        service.toggle('portal');
        expect(service.stateOf('portal')()).toBe('categories-hidden');
    });

    it('ignores and removes the legacy shared key instead of inheriting it', () => {
        localStorage.setItem(
            LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY,
            'collapsed'
        );

        const service = createService();

        for (const surface of LIVE_SIDEBAR_SURFACES) {
            expect(service.isCollapsedFor(surface)()).toBe(false);
        }
        expect(
            localStorage.getItem(LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY)
        ).toBeNull();
    });
});
