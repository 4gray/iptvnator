import {
    DEFAULT_LIVE_SIDEBAR_STATE,
    LIVE_SIDEBAR_STATE_STORAGE_KEY,
    isLiveSidebarState,
    restoreLiveSidebarState,
} from './live-sidebar-state';

describe('live sidebar state', () => {
    afterEach(() => {
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
        localStorage.removeItem('custom-live-sidebar-state');
    });

    it('accepts only known sidebar states', () => {
        expect(isLiveSidebarState('expanded')).toBe(true);
        expect(isLiveSidebarState('collapsed')).toBe(true);
        expect(isLiveSidebarState('hidden')).toBe(false);
        expect(isLiveSidebarState(null)).toBe(false);
    });

    it('restores expanded as the default for missing or invalid storage', () => {
        expect(restoreLiveSidebarState()).toBe(DEFAULT_LIVE_SIDEBAR_STATE);

        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'hidden');

        expect(restoreLiveSidebarState()).toBe(DEFAULT_LIVE_SIDEBAR_STATE);
    });

    it('restores collapsed legacy state without writing it', () => {
        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'collapsed');

        expect(restoreLiveSidebarState()).toBe('collapsed');
        expect(localStorage.getItem(LIVE_SIDEBAR_STATE_STORAGE_KEY)).toBe(
            'collapsed'
        );
    });

    it('supports custom storage keys and fallback values', () => {
        expect(
            restoreLiveSidebarState('custom-live-sidebar-state', 'collapsed')
        ).toBe('collapsed');

        localStorage.setItem('custom-live-sidebar-state', 'expanded');

        expect(restoreLiveSidebarState('custom-live-sidebar-state')).toBe(
            'expanded'
        );
    });
});
