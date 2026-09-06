import {
    DEFAULT_LIVE_SIDEBAR_STATE,
    LIVE_SIDEBAR_STATE_STORAGE_KEY,
    isLiveSidebarState,
    persistLiveSidebarState,
    restoreLiveSidebarState,
} from './live-sidebar-state';

describe('live sidebar state', () => {
    afterEach(() => {
        localStorage.removeItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
        localStorage.removeItem('custom-live-sidebar-state');
    });

    it('accepts only known sidebar states', () => {
        expect(isLiveSidebarState('expanded')).toBe(true);
        expect(isLiveSidebarState('categories-hidden')).toBe(true);
        expect(isLiveSidebarState('collapsed')).toBe(true);
        expect(isLiveSidebarState('hidden')).toBe(false);
        expect(isLiveSidebarState(null)).toBe(false);
    });

    it('restores expanded as the default for missing or invalid storage', () => {
        expect(restoreLiveSidebarState()).toBe(DEFAULT_LIVE_SIDEBAR_STATE);

        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'hidden');

        expect(restoreLiveSidebarState()).toBe(DEFAULT_LIVE_SIDEBAR_STATE);
    });

    it('restores a hidden categories rail as stored', () => {
        persistLiveSidebarState('categories-hidden');

        expect(localStorage.getItem(LIVE_SIDEBAR_STATE_STORAGE_KEY)).toBe(
            'categories-hidden'
        );
        expect(restoreLiveSidebarState()).toBe('categories-hidden');
    });

    it('persists collapsed but restores it one level up, so a restart always shows the channels list (#1458)', () => {
        persistLiveSidebarState('collapsed');

        expect(localStorage.getItem(LIVE_SIDEBAR_STATE_STORAGE_KEY)).toBe(
            'collapsed'
        );
        expect(restoreLiveSidebarState()).toBe('categories-hidden');
    });

    it('supports custom storage keys and fallback values', () => {
        expect(
            restoreLiveSidebarState(
                'custom-live-sidebar-state',
                'categories-hidden'
            )
        ).toBe('categories-hidden');

        persistLiveSidebarState('expanded', 'custom-live-sidebar-state');

        expect(restoreLiveSidebarState('custom-live-sidebar-state')).toBe(
            'expanded'
        );
    });
});
