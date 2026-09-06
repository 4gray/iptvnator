import {
    DEFAULT_LIVE_SIDEBAR_STATE,
    forgetLegacyLiveSidebarState,
    isLiveSidebarState,
    LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY,
    LIVE_SIDEBAR_SURFACES,
    liveSidebarStateStorageKey,
    persistLiveSidebarState,
    resolveRouteLiveSidebarSurface,
    restoreLiveSidebarState,
} from './live-sidebar-state';

describe('live sidebar state', () => {
    const key = liveSidebarStateStorageKey('m3u');

    afterEach(() => {
        localStorage.removeItem(key);
        localStorage.removeItem(LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY);
    });

    it('accepts only known sidebar states', () => {
        expect(isLiveSidebarState('expanded')).toBe(true);
        expect(isLiveSidebarState('collapsed')).toBe(true);
        expect(isLiveSidebarState('hidden')).toBe(false);
        expect(isLiveSidebarState(null)).toBe(false);
    });

    it('derives one storage key per surface under the legacy prefix', () => {
        const keys = LIVE_SIDEBAR_SURFACES.map(liveSidebarStateStorageKey);

        expect(keys).toEqual([
            'live-sidebar-state:m3u',
            'live-sidebar-state:portal',
            'live-sidebar-state:collection',
        ]);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).not.toContain(LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY);
    });

    it('restores expanded as the default for missing or invalid storage', () => {
        expect(restoreLiveSidebarState(key)).toBe(DEFAULT_LIVE_SIDEBAR_STATE);

        localStorage.setItem(key, 'hidden');

        expect(restoreLiveSidebarState(key)).toBe(DEFAULT_LIVE_SIDEBAR_STATE);
    });

    it('restores and persists collapsed state under the given key', () => {
        persistLiveSidebarState('collapsed', key);

        expect(localStorage.getItem(key)).toBe('collapsed');
        expect(restoreLiveSidebarState(key)).toBe('collapsed');
        expect(restoreLiveSidebarState(key, 'expanded')).toBe('collapsed');
    });

    it('never reads the legacy shared key and can forget it', () => {
        localStorage.setItem(
            LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY,
            'collapsed'
        );

        expect(restoreLiveSidebarState(key)).toBe('expanded');

        forgetLegacyLiveSidebarState();

        expect(
            localStorage.getItem(LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY)
        ).toBeNull();
    });

    it('maps only routes that render their own live rail to a surface', () => {
        expect(resolveRouteLiveSidebarSurface('playlists', 'all')).toBe('m3u');
        expect(resolveRouteLiveSidebarSurface('playlists', 'groups')).toBe(
            'm3u'
        );
        expect(resolveRouteLiveSidebarSurface('xtreams', 'live')).toBe(
            'portal'
        );
        expect(resolveRouteLiveSidebarSurface('stalker', 'itv')).toBe('portal');
        expect(resolveRouteLiveSidebarSurface('stalker', 'radio')).toBe(
            'portal'
        );

        // Collection pages own their toggle: only they know whether the live
        // tab is on screen.
        expect(
            resolveRouteLiveSidebarSurface('playlists', 'recent')
        ).toBeNull();
        expect(
            resolveRouteLiveSidebarSurface('xtreams', 'favorites')
        ).toBeNull();
        expect(resolveRouteLiveSidebarSurface('xtreams', 'vod')).toBeNull();
        expect(resolveRouteLiveSidebarSurface('stalker', 'series')).toBeNull();
        expect(resolveRouteLiveSidebarSurface(null, 'live')).toBeNull();
        expect(resolveRouteLiveSidebarSurface('xtreams', null)).toBeNull();
    });
});
